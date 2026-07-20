import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LibraryRegistry, LibraryRegistryError } from '../../src/main/library/library-registry.js';
import {
  RelocationError,
  discardRelocation,
  finishRelocationCleanup,
  probeRelocation,
  recoverRelocations,
  relocateLibrary,
  resumeRelocation,
  stagingPathFor,
  type RelocationDeps,
} from '../../src/main/library/relocation-engine.js';
import { RelocationJournalStore, RelocationJournalError } from '../../src/main/library/relocation-journal.js';
import { RELOCATION_MARKER_FILENAME, type RelocationJournal } from '../../src/shared/library/relocation.js';

// #483 / ADR-0022 §2–§5: registry path rewrite as the commit point, staging
// recognized only by marker+journal, the crash/cancel boundary matrix
// (acceptance 6/7/10), and the no-degrade-to-copy rule.

const ULID_A = '01ARZ3NDEKTSV4RRFFQ69G5FAA';
const ULID_B = '01BRZ3NDEKTSV4RRFFQ69G5FAB';
const NOW = () => new Date('2026-07-19T12:00:00.000Z');

const LIB_FILES: Record<string, string> = {
  'library-id': `${ULID_A}\n`,
  'library.db': 'not-a-real-db-but-bytes-we-can-digest',
  'settings.json': '{"sortOrder":"newest"}',
  'blobs/aa/aabbcc': 'encrypted-original-bytes',
  'thumbs/aa/aabbcc': 'encrypted-thumb-bytes',
};

function makeLibrary(dir: string): void {
  for (const [rel, content] of Object.entries(LIB_FILES)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content, 'utf8');
  }
  // Instance state that must NOT travel (ADR-0022 §4 / engine exclusions).
  writeFileSync(join(dir, 'library.lock'), JSON.stringify({ instanceId: 'stale', pid: 999999, hostname: 'testhost' }), 'utf8');
}

interface Harness {
  readonly root: string;
  readonly sourceDir: string;
  readonly destDir: string;
  readonly registry: LibraryRegistry;
  readonly journals: RelocationJournalStore;
  readonly deps: RelocationDeps;
}

function harness(overrides: Partial<RelocationDeps> = {}, mode: 'copy' | 'rename' = 'copy'): Harness {
  const root = mkdtempSync(join(tmpdir(), 'overlook-relocation-'));
  const sourceDir = join(root, 'old-disk', 'My Library');
  const destDir = join(root, 'new-disk', 'My Library');
  mkdirSync(join(root, 'new-disk'), { recursive: true });
  makeLibrary(sourceDir);
  const registry = new LibraryRegistry({ filePath: join(root, 'libraries.json'), now: NOW });
  registry.register({ id: ULID_A, name: 'My Library', path: sourceDir, createdAt: NOW().toISOString(), lastOpenedAt: null });
  const journals = new RelocationJournalStore(join(root, 'relocations'));
  const deps: RelocationDeps = {
    journals,
    registry,
    instanceId: 'test-instance',
    now: NOW,
    nonce: () => 'test-nonce',
    freeBytes: () => Number.MAX_SAFE_INTEGER,
    sameVolume: () => mode === 'rename',
    lockOptions: { host: 'testhost', pid: 1234, isPidAlive: () => false, now: NOW },
    ...overrides,
  };
  return { root, sourceDir, destDir, registry, journals, deps };
}

function assertSourceIntactAndAuthoritative(h: Harness): void {
  for (const [rel, content] of Object.entries(LIB_FILES)) {
    assert.equal(readFileSync(join(h.sourceDir, rel), 'utf8'), content, `source ${rel} intact`);
  }
  assert.equal(h.registry.get(ULID_A)?.path, h.sourceDir, 'registry still points at source');
  assert.equal(h.journals.load(ULID_A), null, 'journal cleared');
}

describe('library relocation engine (#483, ADR-0022)', () => {
  test('EXIT CRITERIA: copy-mode move — byte-identical files, unchanged id, atomic registry rewrite, no leftovers', async () => {
    const h = harness();
    const progress: string[] = [];
    const result = await relocateLibrary(h.deps, { libraryId: ULID_A, destDir: h.destDir, onProgress: (p) => progress.push(p.phase) });

    assert.equal(result.outcome, 'moved');
    assert.equal(result.mode, 'copy');
    assert.equal(result.items, Object.keys(LIB_FILES).length);
    for (const [rel, content] of Object.entries(LIB_FILES)) {
      assert.equal(readFileSync(join(h.destDir, rel), 'utf8'), content, `dest ${rel} byte-identical`);
    }
    assert.ok(!existsSync(join(h.destDir, 'library.lock')), 'advisory lock never travels');
    assert.ok(!existsSync(join(h.destDir, RELOCATION_MARKER_FILENAME)), 'marker deleted after commit');
    assert.ok(!existsSync(stagingPathFor(h.destDir)), 'staging renamed away');
    assert.ok(!existsSync(h.sourceDir), 'source cleaned up');
    assert.equal(h.registry.get(ULID_A)?.path, h.destDir, 'registry committed to destination');
    assert.equal(h.registry.get(ULID_A)?.id, ULID_A, 'library id unchanged');
    assert.equal(h.journals.load(ULID_A), null, 'journal cleared');
    assert.ok(progress.includes('copying') && progress.includes('verifying') && progress.includes('committing'), 'progress phases emitted');
  });

  test('rename-mode move commits the same way and strips marker and lock from the destination', async () => {
    const h = harness({}, 'rename');
    const result = await relocateLibrary(h.deps, { libraryId: ULID_A, destDir: h.destDir });
    assert.equal(result.outcome, 'moved');
    assert.equal(result.mode, 'rename');
    assert.ok(!existsSync(h.sourceDir));
    assert.equal(readFileSync(join(h.destDir, 'library-id'), 'utf8'), `${ULID_A}\n`);
    assert.ok(!existsSync(join(h.destDir, RELOCATION_MARKER_FILENAME)), 'marker travels through the rename, then dies at commit');
    assert.ok(!existsSync(join(h.destDir, 'library.lock')), 'our traveled lock is removed');
    assert.equal(h.registry.get(ULID_A)?.path, h.destDir);
    assert.equal(h.journals.load(ULID_A), null);
  });

  describe('preflight refusals leave the source untouched and registered (acceptance 7)', () => {
    const refusal = async (h: Harness, expected: string): Promise<void> => {
      await assert.rejects(relocateLibrary(h.deps, { libraryId: ULID_A, destDir: h.destDir }), (error: unknown) => {
        assert.ok(error instanceof RelocationError);
        assert.equal(error.reason, expected);
        return true;
      });
      assertSourceIntactAndAuthoritative(h);
    };

    test('non-empty destination is refused, never merged', async () => {
      const h = harness();
      mkdirSync(h.destDir, { recursive: true });
      writeFileSync(join(h.destDir, 'someone-elses-file'), 'x', 'utf8');
      await refusal(h, 'destination-not-empty');
    });

    test('a registered library path is refused as destination', async () => {
      const h = harness();
      const otherDir = join(h.root, 'other-lib');
      mkdirSync(otherDir, { recursive: true });
      h.registry.register({ id: ULID_B, name: 'Other', path: otherDir, createdAt: NOW().toISOString(), lastOpenedAt: null });
      await assert.rejects(relocateLibrary(h.deps, { libraryId: ULID_A, destDir: join(otherDir, 'nested') }), (error: unknown) => {
        assert.ok(error instanceof RelocationError);
        assert.equal(error.reason, 'destination-registered');
        return true;
      });
      assertSourceIntactAndAuthoritative(h);
    });

    test('a destination inside the moving library is invalid', async () => {
      const h = harness();
      await assert.rejects(relocateLibrary(h.deps, { libraryId: ULID_A, destDir: join(h.sourceDir, 'sub') }), (error: unknown) => {
        assert.ok(error instanceof RelocationError);
        assert.equal(error.reason, 'invalid-destination');
        return true;
      });
      assertSourceIntactAndAuthoritative(h);
    });

    test('insufficient space blocks before any bytes move (copy mode only)', async () => {
      const h = harness({ freeBytes: () => 10 });
      await refusal(h, 'insufficient-space');
      assert.ok(!existsSync(stagingPathFor(h.destDir)), 'no staging was created');
    });

    test('unsupported destination filesystem blocks before moving', async () => {
      const h = harness({ unsupportedFilesystem: () => 'FAT32 cannot hold files over 4 GB' });
      await refusal(h, 'unsupported-filesystem');
    });

    test('a foreign directory at the staging path is refused and never deleted (PR #552 review)', async () => {
      const h = harness();
      const foreign = stagingPathFor(h.destDir);
      mkdirSync(foreign, { recursive: true });
      writeFileSync(join(foreign, 'somebody-elses-data'), 'precious', 'utf8');
      await refusal(h, 'destination-not-empty');
      assert.equal(readFileSync(join(foreign, 'somebody-elses-data'), 'utf8'), 'precious', 'foreign directory untouched');
    });

    test('a registered library at the staging path is refused', async () => {
      const h = harness();
      const otherDir = stagingPathFor(h.destDir);
      mkdirSync(otherDir, { recursive: true });
      h.registry.register({ id: ULID_B, name: 'Other', path: otherDir, createdAt: NOW().toISOString(), lastOpenedAt: null });
      await refusal(h, 'destination-registered');
    });

    test('a file at the destination path is an invalid destination', async () => {
      const h = harness();
      writeFileSync(h.destDir, 'not a folder', 'utf8');
      await refusal(h, 'invalid-destination');
      assert.equal(readFileSync(h.destDir, 'utf8'), 'not a folder', 'file untouched');
    });

    test('a library locked by another live instance refuses to move', async () => {
      const h = harness();
      writeFileSync(
        join(h.sourceDir, 'library.lock'),
        JSON.stringify({ instanceId: 'other-instance', pid: 4321, hostname: 'testhost', acquiredAt: NOW().toISOString() }),
        'utf8',
      );
      const deps = { ...h.deps, lockOptions: { ...h.deps.lockOptions, isPidAlive: () => true } };
      await assert.rejects(relocateLibrary(deps, { libraryId: ULID_A, destDir: h.destDir }), (error: unknown) => {
        assert.ok(error instanceof RelocationError);
        assert.equal(error.reason, 'locked');
        return true;
      });
      assert.equal(h.registry.get(ULID_A)?.path, h.sourceDir);
      assert.equal(h.journals.load(ULID_A), null);
    });
  });

  test('EXIT CRITERIA: verification failure reports FAILED — no degrade-to-copy, staging discarded, source authoritative', async () => {
    const h = harness();
    // Tamper with a staged file after it is copied (same length, different
    // bytes) — the honest re-read digest compare must catch it.
    const tamper = (phase: string): void => {
      const staged = join(stagingPathFor(h.destDir), 'library.db');
      if (phase === 'copying' && existsSync(staged)) {
        writeFileSync(staged, 'not-a-real-db-but-BYTES-we-can-digest', 'utf8');
      }
    };
    await assert.rejects(
      relocateLibrary(h.deps, { libraryId: ULID_A, destDir: h.destDir, onProgress: (p) => tamper(p.phase) }),
      (error: unknown) => {
        assert.ok(error instanceof RelocationError);
        assert.equal(error.reason, 'verification-failed');
        return true;
      },
    );
    assert.ok(!existsSync(stagingPathFor(h.destDir)), 'staging discarded');
    assert.ok(!existsSync(h.destDir), 'no destination library appears');
    assertSourceIntactAndAuthoritative(h);
  });

  test("abandoned staging debris carrying this library's marker is replaced", async () => {
    const h = harness();
    const debris = stagingPathFor(h.destDir);
    mkdirSync(debris, { recursive: true });
    writeFileSync(
      join(debris, RELOCATION_MARKER_FILENAME),
      JSON.stringify({ version: 1, libraryId: ULID_A, nonce: 'stale-nonce' }),
      'utf8',
    );
    writeFileSync(join(debris, 'half-copied.db'), 'junk', 'utf8');

    const result = await relocateLibrary(h.deps, { libraryId: ULID_A, destDir: h.destDir });
    assert.equal(result.outcome, 'moved');
    assert.ok(!existsSync(join(h.destDir, 'half-copied.db')), 'debris was replaced, not merged');
    assert.equal(h.registry.get(ULID_A)?.path, h.destDir);
  });

  test('content appearing in the destination during the copy is refused at activation, never deleted (PR #552 review)', async () => {
    const h = harness();
    const plant = (phase: string, items: number, total: number): void => {
      if (phase === 'copying' && items === total && !existsSync(h.destDir)) {
        mkdirSync(h.destDir, { recursive: true });
        writeFileSync(join(h.destDir, 'arrived-mid-copy'), 'sync tool output', 'utf8');
      }
    };
    await assert.rejects(
      relocateLibrary(h.deps, { libraryId: ULID_A, destDir: h.destDir, onProgress: (p) => plant(p.phase, p.copiedItems, p.totalItems) }),
      (error: unknown) => {
        assert.ok(error instanceof RelocationError);
        assert.equal(error.reason, 'destination-not-empty');
        return true;
      },
    );
    assert.equal(readFileSync(join(h.destDir, 'arrived-mid-copy'), 'utf8'), 'sync tool output', 'late-arriving content preserved');
    assert.ok(!existsSync(stagingPathFor(h.destDir)), 'our staging discarded');
    assertSourceIntactAndAuthoritative(h);
  });

  test('EXIT CRITERIA: cancellation mid-copy leaves the original registered and usable (acceptance 6)', async () => {
    const h = harness();
    const controller = new AbortController();
    await assert.rejects(
      relocateLibrary(h.deps, {
        libraryId: ULID_A,
        destDir: h.destDir,
        signal: controller.signal,
        onProgress: (p) => {
          if (p.phase === 'copying' && p.copiedItems === 1) controller.abort();
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof RelocationError);
        assert.equal(error.reason, 'cancelled');
        return true;
      },
    );
    assert.ok(!existsSync(stagingPathFor(h.destDir)), 'staging discarded');
    assertSourceIntactAndAuthoritative(h);
  });

  test('EXIT CRITERIA: cleanup failure after commit keeps both verified copies and retries safely (acceptance 10)', async () => {
    const h = harness();
    let failNext = true;
    const deps: RelocationDeps = {
      ...h.deps,
      ops: {
        rmrf: async (target) => {
          if (failNext && target === h.sourceDir) {
            failNext = false;
            throw new Error('EBUSY: simulated');
          }
          await rm(target, { recursive: true, force: true });
        },
      },
    };
    const result = await relocateLibrary(deps, { libraryId: ULID_A, destDir: h.destDir });

    assert.equal(result.outcome, 'moved-cleanup-pending', 'a success variant, never a failure');
    assert.ok(existsSync(h.sourceDir), 'source copy still present');
    assert.ok(existsSync(h.destDir), 'destination copy present');
    assert.equal(h.registry.get(ULID_A)?.path, h.destDir, 'registry committed — the move happened');
    assert.equal(h.journals.load(ULID_A)?.state, 'committed', 'journal records the pending cleanup');

    assert.equal(await finishRelocationCleanup(h.deps, ULID_A), 'cleaned');
    assert.ok(!existsSync(h.sourceDir), 'retry finished cleanup');
    assert.equal(h.journals.load(ULID_A), null);
  });

  describe('startup recovery acts only on what journals record (ADR-0022 §2)', () => {
    const journalFor = (h: Harness, state: RelocationJournal['state'], mode: 'copy' | 'rename' = 'copy'): RelocationJournal =>
      h.journals.save({
        version: 1,
        libraryId: ULID_A,
        nonce: 'test-nonce',
        sourcePath: h.sourceDir,
        destPath: h.destDir,
        stagingPath: stagingPathFor(h.destDir),
        mode,
        state,
        startedAt: NOW().toISOString(),
      });
    const marker = JSON.stringify({ version: 1, libraryId: ULID_A, nonce: 'test-nonce' });

    test('pre-commit copy crash: marker-bound staging is preserved for an explicit choice', async () => {
      const h = harness();
      journalFor(h, 'copying');
      mkdirSync(stagingPathFor(h.destDir), { recursive: true });
      writeFileSync(join(stagingPathFor(h.destDir), RELOCATION_MARKER_FILENAME), marker, 'utf8');
      writeFileSync(join(stagingPathFor(h.destDir), 'library.db'), 'partial', 'utf8');

      const reports = await recoverRelocations(h.deps);
      assert.deepEqual(reports, [{ libraryId: ULID_A, action: 'resume-available' }]);
      assert.ok(existsSync(stagingPathFor(h.destDir)));
      assert.equal(h.registry.get(ULID_A)?.path, h.sourceDir);
      assert.equal(h.journals.load(ULID_A)?.state, 'copying');
    });

    test('crash between activation rename and commit: marker-bound destination remains resumable staging', async () => {
      const h = harness();
      journalFor(h, 'verified');
      mkdirSync(h.destDir, { recursive: true });
      writeFileSync(join(h.destDir, RELOCATION_MARKER_FILENAME), marker, 'utf8');
      writeFileSync(join(h.destDir, 'library-id'), `${ULID_A}\n`, 'utf8');

      const reports = await recoverRelocations(h.deps);
      assert.deepEqual(reports, [{ libraryId: ULID_A, action: 'resume-available' }]);
      assert.ok(existsSync(h.destDir), 'marker-bound destination preserved');
      assert.equal(h.registry.get(ULID_A)?.path, h.sourceDir);
    });

    test('a destination WITHOUT our marker is never deleted, whatever the journal claims', async () => {
      const h = harness();
      journalFor(h, 'verified');
      mkdirSync(h.destDir, { recursive: true });
      writeFileSync(join(h.destDir, 'precious-user-data'), 'irreplaceable', 'utf8');

      const reports = await recoverRelocations(h.deps);
      assert.equal(reports[0]?.action, 'inconsistent');
      assert.equal(readFileSync(join(h.destDir, 'precious-user-data'), 'utf8'), 'irreplaceable', 'unmarked directory untouched');
      assert.equal(h.registry.get(ULID_A)?.path, h.sourceDir);
      assert.equal(h.journals.load(ULID_A)?.state, 'verified');
    });

    test('Discard removes only marker-bound staging and clears the pre-commit journal', async () => {
      const h = harness();
      journalFor(h, 'copying');
      mkdirSync(stagingPathFor(h.destDir), { recursive: true });
      writeFileSync(join(stagingPathFor(h.destDir), RELOCATION_MARKER_FILENAME), marker, 'utf8');
      writeFileSync(join(stagingPathFor(h.destDir), 'library.db'), 'partial', 'utf8');

      assert.equal(await discardRelocation(h.deps, ULID_A), 'discarded');
      assert.ok(!existsSync(stagingPathFor(h.destDir)));
      assertSourceIntactAndAuthoritative(h);
    });

    test('Resume reuses verified files, replaces partial files, and copies only the remainder', async () => {
      const h = harness();
      journalFor(h, 'copying');
      const staging = stagingPathFor(h.destDir);
      mkdirSync(join(staging, 'blobs/aa'), { recursive: true });
      writeFileSync(join(staging, RELOCATION_MARKER_FILENAME), marker, 'utf8');
      writeFileSync(join(staging, 'library-id'), LIB_FILES['library-id'] ?? '', 'utf8');
      writeFileSync(join(staging, 'library.db'), 'partial', 'utf8');
      writeFileSync(join(staging, 'settings.json'), '{"sortOrder":"oldest"}', 'utf8');
      writeFileSync(join(staging, 'blobs/aa/aabbcc'), LIB_FILES['blobs/aa/aabbcc'] ?? '', 'utf8');
      const copying: number[] = [];

      const result = await resumeRelocation(h.deps, {
        libraryId: ULID_A,
        onProgress: (progress) => {
          if (progress.phase === 'copying') copying.push(progress.copiedItems);
        },
      });

      assert.equal(copying[0], 2, 'two exact staged files were reused before copying resumed');
      assert.equal(result.outcome, 'moved');
      assert.equal(readFileSync(join(h.destDir, 'library.db'), 'utf8'), LIB_FILES['library.db']);
      assert.equal(readFileSync(join(h.destDir, 'settings.json'), 'utf8'), LIB_FILES['settings.json']);
      assert.ok(!existsSync(h.sourceDir));
      assert.equal(h.registry.get(ULID_A)?.path, h.destDir);
    });

    test('cancelling a resumed copy uses the same pre-commit discard recovery as a fresh move', async () => {
      const h = harness();
      journalFor(h, 'copying');
      const staging = stagingPathFor(h.destDir);
      mkdirSync(staging, { recursive: true });
      writeFileSync(join(staging, RELOCATION_MARKER_FILENAME), marker, 'utf8');
      const controller = new AbortController();

      await assert.rejects(
        resumeRelocation(h.deps, {
          libraryId: ULID_A,
          signal: controller.signal,
          onProgress: (progress) => {
            if (progress.phase === 'copying' && progress.copiedItems === 1) controller.abort();
          },
        }),
        (error: unknown) => error instanceof RelocationError && error.reason === 'cancelled',
      );
      assert.ok(!existsSync(staging));
      assertSourceIntactAndAuthoritative(h);
    });

    test('committed journal with surviving source: cleanup finishes', async () => {
      const h = harness();
      h.registry.updatePath(ULID_A, h.destDir);
      journalFor(h, 'committed');
      mkdirSync(h.destDir, { recursive: true });
      writeFileSync(join(h.destDir, 'library-id'), `${ULID_A}\n`, 'utf8');

      const reports = await recoverRelocations(h.deps);
      assert.deepEqual(reports, [{ libraryId: ULID_A, action: 'cleanup-finished' }]);
      assert.ok(!existsSync(h.sourceDir), 'source removed');
      assert.ok(existsSync(h.destDir), 'destination is the library');
      assert.equal(h.journals.load(ULID_A), null);
    });

    test('crash between registry rewrite and journal advance: the registry is the arbiter — commit completes', async () => {
      const h = harness();
      journalFor(h, 'verified');
      h.registry.updatePath(ULID_A, h.destDir);
      mkdirSync(h.destDir, { recursive: true });
      writeFileSync(join(h.destDir, RELOCATION_MARKER_FILENAME), marker, 'utf8');
      writeFileSync(join(h.destDir, 'library-id'), `${ULID_A}\n`, 'utf8');

      const reports = await recoverRelocations(h.deps);
      assert.deepEqual(reports, [{ libraryId: ULID_A, action: 'commit-completed' }]);
      assert.ok(!existsSync(join(h.destDir, RELOCATION_MARKER_FILENAME)), 'marker removed');
      assert.ok(!existsSync(h.sourceDir), 'source cleaned up');
      assert.equal(h.registry.get(ULID_A)?.path, h.destDir);
      assert.equal(h.journals.load(ULID_A), null);
    });

    test('rename-mode crash after the rename: journal rolls the commit forward (only one copy exists)', async () => {
      const h = harness({}, 'rename');
      journalFor(h, 'copying', 'rename');
      await rename(h.sourceDir, h.destDir);
      writeFileSync(join(h.destDir, RELOCATION_MARKER_FILENAME), marker, 'utf8');

      const reports = await recoverRelocations(h.deps);
      assert.deepEqual(reports, [{ libraryId: ULID_A, action: 'commit-completed' }]);
      assert.equal(h.registry.get(ULID_A)?.path, h.destDir, 'registry re-pointed from the journal');
      assert.ok(!existsSync(join(h.destDir, RELOCATION_MARKER_FILENAME)));
      assert.equal(h.journals.load(ULID_A), null);
    });

    test('rename-mode crash before the rename: marker removed from source, move discarded', async () => {
      const h = harness({}, 'rename');
      journalFor(h, 'copying', 'rename');
      writeFileSync(join(h.sourceDir, RELOCATION_MARKER_FILENAME), marker, 'utf8');

      const reports = await recoverRelocations(h.deps);
      assert.deepEqual(reports, [{ libraryId: ULID_A, action: 'discarded' }]);
      assert.ok(!existsSync(join(h.sourceDir, RELOCATION_MARKER_FILENAME)));
      assertSourceIntactAndAuthoritative(h);
    });

    test('a corrupt journal surfaces and blocks recovery for that library only', async () => {
      const h = harness();
      mkdirSync(join(h.root, 'relocations'), { recursive: true });
      writeFileSync(join(h.root, 'relocations', `${ULID_A}.json`), '{ not json', 'utf8');

      const reports = await recoverRelocations(h.deps);
      assert.equal(reports[0]?.action, 'corrupt-journal');
      assert.equal(h.registry.get(ULID_A)?.path, h.sourceDir, 'nothing acted on');
    });
  });

  describe('relocation journal store (ADR-0022 §2)', () => {
    test('absent is a valid state; corrupt fails loud, never self-heals', () => {
      const dir = mkdtempSync(join(tmpdir(), 'overlook-journal-'));
      const store = new RelocationJournalStore(join(dir, 'relocations'));
      assert.equal(store.load(ULID_A), null);
      mkdirSync(join(dir, 'relocations'), { recursive: true });
      writeFileSync(join(dir, 'relocations', `${ULID_A}.json`), '{"version":99}', 'utf8');
      assert.throws(() => store.load(ULID_A), RelocationJournalError);
    });

    test('atomic tmp+rename persistence round-trips', () => {
      const dir = mkdtempSync(join(tmpdir(), 'overlook-journal-'));
      const store = new RelocationJournalStore(join(dir, 'relocations'));
      const journal: RelocationJournal = {
        version: 1,
        libraryId: ULID_A,
        nonce: 'n',
        sourcePath: '/a',
        destPath: '/b',
        stagingPath: '/b.relocate-staging',
        mode: 'copy',
        state: 'copying',
        startedAt: NOW().toISOString(),
      };
      store.save(journal);
      assert.ok(!existsSync(join(dir, 'relocations', `${ULID_A}.json.tmp`)));
      assert.equal(store.load(ULID_A)?.state, 'copying');
      store.advance(journal, 'verified');
      assert.equal(store.load(ULID_A)?.state, 'verified');
      store.clear(ULID_A);
      assert.equal(store.load(ULID_A), null);
    });
  });

  describe('registry path rewrite (ADR-0022 §1)', () => {
    test('updatePath persists atomically and preserves identity', () => {
      const h = harness();
      const updated = h.registry.updatePath(ULID_A, h.destDir);
      assert.equal(updated.id, ULID_A);
      assert.equal(updated.path, h.destDir);
      const reborn = new LibraryRegistry({ filePath: join(h.root, 'libraries.json'), now: NOW });
      assert.equal(reborn.get(ULID_A)?.path, h.destDir);
    });

    test('updatePath refuses unknown ids and path clashes with other entries', () => {
      const h = harness();
      assert.throws(() => h.registry.updatePath(ULID_B, '/nowhere'), LibraryRegistryError);
      const otherDir = join(h.root, 'other-lib');
      h.registry.register({ id: ULID_B, name: 'Other', path: otherDir, createdAt: NOW().toISOString(), lastOpenedAt: null });
      assert.throws(() => h.registry.updatePath(ULID_A, otherDir), LibraryRegistryError);
      assert.equal(h.registry.updatePath(ULID_A, h.sourceDir).path, h.sourceDir, 'no-op re-point to own path is allowed');
    });
  });

  describe('preflight probe — Review-step dry run (#483, ADR-0022 §5)', () => {
    test('a copy-mode probe reports method, exact bytes, free space, and takes no lock, journal, or staging', async () => {
      const h = harness({ freeBytes: () => 500_000_000, networkVolume: () => false });
      const probe = await probeRelocation(h.deps, { libraryId: ULID_A, destDir: h.destDir });
      assert.ok(probe.ok);
      assert.equal(probe.mode, 'copy');
      assert.equal(probe.items, Object.keys(LIB_FILES).length);
      assert.ok(probe.requiredBytes > 0);
      assert.equal(probe.freeBytes, 500_000_000);
      assert.equal(probe.network, false);
      assert.equal(probe.lockedBy, null);
      assert.equal(h.journals.load(ULID_A), null, 'no journal written');
      assert.ok(!existsSync(stagingPathFor(h.destDir)), 'no staging created');
      assert.ok(!existsSync(join(h.sourceDir, 'library.lock.probe')), 'nothing new in the source');
    });

    test('same-volume probes resolve INSTANT MOVE and flag network destinations as a warning, not a refusal', async () => {
      const h = harness({ networkVolume: () => true }, 'rename');
      const probe = await probeRelocation(h.deps, { libraryId: ULID_A, destDir: h.destDir });
      assert.ok(probe.ok);
      assert.equal(probe.mode, 'rename');
      assert.equal(probe.network, true, 'ADR-0017 §5: warn, never block');
    });

    test('probe refusals carry the same stable reasons as the move', async () => {
      const h = harness();
      mkdirSync(h.destDir, { recursive: true });
      writeFileSync(join(h.destDir, 'occupied'), 'x', 'utf8');
      const probe = await probeRelocation(h.deps, { libraryId: ULID_A, destDir: h.destDir });
      assert.ok(!probe.ok);
      assert.equal(probe.reason, 'destination-not-empty');
      assertSourceIntactAndAuthoritative(h);
    });

    test('a probe names the host holding the source lock instead of failing', async () => {
      const h = harness();
      writeFileSync(
        join(h.sourceDir, 'library.lock'),
        JSON.stringify({ instanceId: 'other', pid: 4321, hostname: 'OTHER-HOST', acquiredAt: NOW().toISOString() }),
        'utf8',
      );
      const probe = await probeRelocation(h.deps, { libraryId: ULID_A, destDir: h.destDir });
      assert.ok(probe.ok);
      assert.equal(probe.lockedBy, 'OTHER-HOST');
    });
  });

  test('EXIT CRITERIA: fault hooks fire at every §4 boundary in protocol order (acceptance 6 harness)', async () => {
    const fired: string[] = [];
    let arm = '';
    const h = harness({
      fault: () => arm,
      exit: (code: number): never => {
        throw new RelocationError('io-error', `fault-exit:${String(code)}`);
      },
    });
    // Walk the boundaries: each armed point interrupts exactly there.
    for (const point of ['after-copy', 'after-verify', 'after-activate', 'after-commit']) {
      const fresh = harness({
        fault: () => point,
        exit: (): never => {
          fired.push(point);
          throw new RelocationError('io-error', `fault:${point}`);
        },
      });
      await assert.rejects(relocateLibrary(fresh.deps, { libraryId: ULID_A, destDir: fresh.destDir }));
    }
    assert.deepEqual(fired, ['after-copy', 'after-verify', 'after-activate', 'after-commit']);
    // Unarmed: the same move completes untouched.
    arm = '';
    const result = await relocateLibrary(h.deps, { libraryId: ULID_A, destDir: h.destDir });
    assert.equal(result.outcome, 'moved');
  });
});
