import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LibraryRegistry, LibraryRegistryError, ensureDefaultEntry } from '../../src/main/library/library-registry.js';
import { LibraryRegistryRuntime } from '../../src/main/library/library-registry-runtime.js';
import { channels } from '../../src/shared/ipc/channels.js';
import { wrapHandler } from '../../src/shared/ipc/registry.js';
import { selectStartupLibrary, type LibraryEntry } from '../../src/shared/library/registry.js';

// #384 / ADR-0017 §1/§7: standalone fail-loud registry with atomic writes,
// registry-only removal, and the register-in-place legacy migration.

const ULID_A = '01ARZ3NDEKTSV4RRFFQ69G5FAA';
const ULID_B = '01BRZ3NDEKTSV4RRFFQ69G5FAB';

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: ULID_A,
    name: 'My Library',
    path: '/tmp/lib-a',
    createdAt: '2026-07-16T00:00:00.000Z',
    lastOpenedAt: null,
    ...overrides,
  };
}

function registryIn(dir: string): LibraryRegistry {
  return new LibraryRegistry({ filePath: join(dir, 'libraries.json'), now: () => new Date('2026-07-16T12:00:00.000Z') });
}

describe('library registry (#384)', () => {
  test('an absent file is an empty registry, not an error', () => {
    const registry = registryIn(mkdtempSync(join(tmpdir(), 'overlook-registry-')));
    assert.deepEqual(registry.list(), []);
    assert.equal(registry.startupEntry(), undefined);
  });

  test('EXIT CRITERIA: entries persist across restart with atomic tmp+rename semantics', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlook-registry-'));
    registryIn(dir).register(entry());

    assert.ok(existsSync(join(dir, 'libraries.json')));
    assert.ok(!existsSync(join(dir, 'libraries.json.tmp')), 'staging file is renamed away');
    const reborn = registryIn(dir);
    assert.equal(reborn.list().length, 1);
    assert.equal(reborn.get(ULID_A)?.name, 'My Library');
  });

  test('EXIT CRITERIA: a corrupt registry fails loud — never self-heals to empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlook-registry-'));
    writeFileSync(join(dir, 'libraries.json'), '{ not json', 'utf8');
    assert.throws(() => registryIn(dir), LibraryRegistryError);

    // Parseable but invalid is equally corrupt (a truncated rewrite, a wrong
    // schema) — silently dropping entries here is the failure mode ADR-0017
    // §1 forbids.
    writeFileSync(join(dir, 'libraries.json'), JSON.stringify({ version: 1, entries: [{ id: 'nope' }] }), 'utf8');
    assert.throws(() => registryIn(dir), LibraryRegistryError);
    assert.match(readFileSync(join(dir, 'libraries.json'), 'utf8'), /nope/, 'the corrupt file is left in place for recovery');
  });

  test('duplicate ids and duplicate resolved paths are rejected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlook-registry-'));
    const registry = registryIn(dir);
    registry.register(entry());
    assert.throws(() => registry.register(entry({ name: 'Again' })), LibraryRegistryError);
    assert.throws(
      () => registry.register(entry({ id: ULID_B, path: '/tmp/../tmp/lib-a' })),
      LibraryRegistryError,
      'path clash detected through normalization',
    );
  });

  test('EXIT CRITERIA: remove forgets the entry and touches nothing on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlook-registry-'));
    const libraryDir = join(dir, 'the-library');
    mkdirSync(libraryDir, { recursive: true });
    writeFileSync(join(libraryDir, 'library.db'), 'not-really-a-db', 'utf8');
    writeFileSync(join(libraryDir, 'master.key'), 'wrapped', 'utf8');

    const registry = registryIn(dir);
    registry.register(entry({ path: libraryDir }));
    assert.equal(registry.remove(ULID_A), true);
    assert.equal(registry.remove(ULID_A), false, 'second remove is a no-op');
    assert.deepEqual(registry.list(), []);
    assert.ok(existsSync(join(libraryDir, 'library.db')), 'database intact');
    assert.ok(existsSync(join(libraryDir, 'master.key')), 'key custody intact');
  });

  test('touchOpened stamps lastOpenedAt and drives startup selection', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlook-registry-'));
    const registry = registryIn(dir);
    registry.register(entry());
    registry.register(entry({ id: ULID_B, path: '/tmp/lib-b', name: 'Second' }));

    registry.touchOpened(ULID_B);
    assert.equal(registry.startupEntry()?.id, ULID_B, 'most recently opened wins');
    assert.equal(registryIn(dir).startupEntry()?.id, ULID_B, 'selection survives restart');
    assert.throws(() => registry.touchOpened('01CRZ3NDEKTSV4RRFFQ69G5FAC'), LibraryRegistryError);
  });

  test('startup selection is deterministic: opened beats never-opened, then createdAt, then id', () => {
    const never = entry({ id: ULID_A, createdAt: '2026-07-01T00:00:00.000Z' });
    const opened = entry({ id: ULID_B, path: '/tmp/lib-b', lastOpenedAt: '2026-07-02T00:00:00.000Z' });
    assert.equal(selectStartupLibrary([never, opened])?.id, ULID_B);
    assert.equal(selectStartupLibrary([never])?.id, ULID_A);
    assert.equal(selectStartupLibrary([]), undefined);
  });

  test('REGRESSION: a fresh profile resolves without touching disk (restore needs a pristine target)', () => {
    const userData = mkdtempSync(join(tmpdir(), 'overlook-registry-'));
    const runtime = new LibraryRegistryRuntime({ userDataDir: () => userData });

    const virtual = runtime.resolveActive();
    assert.equal(runtime.dataDir(), join(userData, 'library'));
    assert.ok(!existsSync(join(userData, 'library')), 'no legacy directory created at resolution');
    assert.ok(!existsSync(join(userData, 'libraries.json')), 'no registry file written at resolution');
    assert.deepEqual(runtime.list(null), [], 'virtual default is not a registry entry');

    // First real open materializes it (§7): directory id pinned, entry registered.
    const opened = runtime.healActiveId();
    assert.equal(opened.id, virtual.id);
    assert.equal(readFileSync(join(userData, 'library', 'library-id'), 'utf8'), opened.id);
    assert.equal(runtime.list(null).length, 1);
  });

  function seedLegacyInstall(userData: string): void {
    mkdirSync(join(userData, 'library'), { recursive: true });
    writeFileSync(join(userData, 'library', 'library.db'), 'sqlcipher-bytes', 'utf8');
  }

  test('select stamps the choice, reports requiresRestart while another library is open, and refuses missing paths', () => {
    const userData = mkdtempSync(join(tmpdir(), 'overlook-registry-'));
    seedLegacyInstall(userData);
    const runtime = new LibraryRegistryRuntime({ userDataDir: () => userData });
    const first = runtime.resolveActive();
    const realDir = join(userData, 'second');
    mkdirSync(realDir, { recursive: true });
    const second = runtime.getRegistry().register(entry({ id: ULID_B, path: realDir, name: 'Second' }));
    const ghost = runtime.getRegistry().register(entry({ id: '01CRZ3NDEKTSV4RRFFQ69G5FAC', path: join(userData, 'gone'), name: 'Ghost' }));

    // Nothing open yet: selection re-points the active library in place.
    const idle = runtime.select(second.id, null);
    assert.equal(idle.requiresRestart, false);
    assert.equal(runtime.dataDir(), realDir);

    // A different library is open: selection persists but needs a restart
    // until #385 lands the live switch.
    const busy = runtime.select(first.id, second.id);
    assert.equal(busy.requiresRestart, true);

    assert.throws(() => runtime.select(ghost.id, null), LibraryRegistryError, 'missing directory refuses selection');
  });

  test('removeEntry guards the open library and re-resolves a removed selection', () => {
    const userData = mkdtempSync(join(tmpdir(), 'overlook-registry-'));
    seedLegacyInstall(userData);
    const runtime = new LibraryRegistryRuntime({ userDataDir: () => userData });
    const first = runtime.resolveActive();
    assert.throws(() => runtime.removeEntry(first.id, first.id), LibraryRegistryError, 'the open library cannot be removed');
    assert.equal(runtime.removeEntry(first.id, null), true, 'removable once nothing has it open');
    assert.notEqual(runtime.resolveActive().path, '', 're-resolution yields a usable default');
  });

  test('IPC boundary: the open channel rejects a malformed library id at the schema', async () => {
    const handler = wrapHandler(channels.libraryRegistryOpen, () => {
      throw new Error('handler must not run');
    });
    await assert.rejects(handler({ id: 'not-a-ulid' }));
  });

  test('EXIT CRITERIA: migration registers the legacy directory in place, exactly once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlook-registry-'));
    const legacyDir = join(dir, 'library');
    const registry = registryIn(dir);

    let minted = 0;
    const options = {
      legacyDir,
      libraryId: () => {
        minted += 1;
        return ULID_A;
      },
    };
    const first = ensureDefaultEntry(registry, options);
    assert.equal(first.path, legacyDir);
    assert.equal(first.name, 'My Library');
    assert.equal(minted, 1);

    const again = ensureDefaultEntry(registry, options);
    assert.equal(again.id, first.id, 'idempotent — an existing entry short-circuits');
    assert.equal(minted, 1, 'no second id minted');
    assert.equal(registry.list().length, 1);
  });
});
