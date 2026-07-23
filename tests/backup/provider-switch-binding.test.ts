import { test } from 'node:test';
import assert from 'node:assert/strict';

import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { MockProvider } from '../../src/main/backup/mock-provider.js';
import { createManifestDebtStore } from '../../src/main/backup/manifest-debt.js';
import { createBackupClaimDeps } from '../../src/main/db/backup-claims.js';
import { createProviderSwitchGuard, type ProviderSwitchGuardParts } from '../../src/main/backup/provider-switch-binding.js';
import type { StorageProvider } from '../../src/main/backup/provider.js';
import { openLibraryDatabase } from '../../src/main/db/database.js';
import { PhotosRepository } from '../../src/main/db/photos-repository.js';
import { queryAll, run } from '../../src/main/db/sql.js';
import type { PhotoInsert } from '../../src/shared/library/types.js';

// #741: the composition seam wires the guard to the open library's parts —
// claims from the DB, local presence from the blob store, durable manifest
// debt, and the audit trail under the library data dir.

const HASH = `4f${'1'.repeat(62)}`;

function world(): { parts: ProviderSwitchGuardParts; dataDir: string } {
  const dataDir = mkdtempSync(join(tmpdir(), 'overlook-switch-binding-'));
  const db = openLibraryDatabase({ path: join(dataDir, 'library.db'), dbKey: randomBytes(32) });
  run(db, `INSERT OR IGNORE INTO keys (id, wrapped_key, created_at) VALUES (1, 'test', '2026-07-23T00:00:00.000Z')`);
  new PhotosRepository(db).insert({
    id: 'P0',
    fileName: 'IMG_0.JPG',
    fileKind: 'jpeg',
    width: 1,
    height: 1,
    bytes: 10,
    contentHash: HASH,
    camera: null,
    lens: null,
    iso: null,
    aperture: null,
    shutter: null,
    focalLength: null,
    takenAt: null,
    gpsLat: null,
    gpsLon: null,
    place: null,
    importedAt: '2026-07-23T00:00:00.000Z',
    importSource: 'test',
    keyId: 1,
  } satisfies PhotoInsert);
  run(db, `UPDATE sync_ledger SET status = 'synced', dirty = 0 WHERE photo_id = 'P0'`);
  const parts: ProviderSwitchGuardParts = {
    db,
    blobStore: { hasOriginal: () => true },
    protected: {
      switchGuardBinding: () => ({
        claims: () => [],
        hasLocal: () => false,
        requeue: () => undefined,
        heal: () => undefined,
      }),
    },
  };
  return { parts, dataDir };
}

function targetProvider(): StorageProvider {
  return new MockProvider({ rootDir: mkdtempSync(join(tmpdir(), 'overlook-switch-binding-remote-')) });
}

test('the bound guard re-queues local claims the target is missing, records manifest debt, and audits (#741)', async () => {
  const { parts, dataDir } = world();
  const guard = createProviderSwitchGuard({ parts: () => parts, libraryDataDir: () => dataDir });
  const verdict = await guard({ providerId: 'mock', provider: targetProvider() });
  assert.deepEqual(verdict, { ok: true, reason: null });
  assert.equal(
    queryAll<{ dirty: number }>(parts.db, `SELECT dirty FROM sync_ledger WHERE photo_id = 'P0'`)[0]?.dirty,
    1,
    'the locally available claim re-queued for the target',
  );
  assert.equal(createManifestDebtStore(parts.db).load(), true, 'the switch owes the target a generation');
  // The audit trail is a best-effort async append (create, then write) —
  // poll for the CONTENT, not the file's existence.
  const auditPath = join(dataDir, 'backup-audit.log');
  const deadline = Date.now() + 5_000;
  let audit = '';
  while (Date.now() < deadline) {
    audit = existsSync(auditPath) ? readFileSync(auditPath, 'utf8') : '';
    if (audit.includes('PROVIDER-SWITCH-VERIFIED')) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.match(audit, /PROVIDER-SWITCH-VERIFIED provider=mock/u);
});

test('the bound guard fails closed on remote-only claims the target cannot prove (#741)', async () => {
  const { parts, dataDir } = world();
  const remoteOnly: ProviderSwitchGuardParts = { ...parts, blobStore: { hasOriginal: () => false } };
  const guard = createProviderSwitchGuard({ parts: () => remoteOnly, libraryDataDir: () => dataDir });
  const verdict = await guard({ providerId: 'mock', provider: targetProvider() });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason ?? '', /not in this provider/u);
  assert.equal(createManifestDebtStore(parts.db).load(), false, 'a refused switch records no debt');
});

test('a target already holding the remote-only blob is accepted', async () => {
  const { parts, dataDir } = world();
  const remoteOnly: ProviderSwitchGuardParts = { ...parts, blobStore: { hasOriginal: () => false } };
  const provider = targetProvider();
  await provider.put(`blobs/${HASH.slice(0, 2)}/${HASH}`, Readable.from([Buffer.from('ciphertext')]));
  const guard = createProviderSwitchGuard({ parts: () => remoteOnly, libraryDataDir: () => dataDir });
  assert.deepEqual(await guard({ providerId: 'mock', provider }), { ok: true, reason: null });
});

test('createBackupClaimDeps bundles claim lookup, local presence, and durable debt over one DB', () => {
  const { parts } = world();
  const deps = createBackupClaimDeps(parts.db, { hasOriginal: (hash) => hash === HASH });
  assert.equal(deps.hasLocalOriginal?.(HASH), true);
  assert.equal(deps.hasLocalOriginal?.('feed'.repeat(16)), false);
  assert.deepEqual(
    deps.claimsForContentHashes?.([HASH]).map((claim) => ({ id: claim.id, status: claim.status, deleted: claim.deleted })),
    [{ id: 'P0', status: 'synced', deleted: false }],
  );
  deps.manifestDebt?.save(true);
  assert.equal(deps.manifestDebt?.load(), true);
  deps.manifestDebt?.save(false);
  assert.equal(deps.manifestDebt?.load(), false);
});

test('no open library: the guard allows activation and never bootstraps one (PR #743 review)', async () => {
  let resolved = 0;
  const guard = createProviderSwitchGuard({
    parts: () => {
      resolved += 1;
      return null;
    },
    libraryDataDir: () => {
      throw new Error('the audit path must not be touched without a library');
    },
  });
  const failing: StorageProvider = {
    ...targetProvider(),
    list: () => Promise.reject(new Error('no provider round-trip without a library')),
  };
  assert.deepEqual(await guard({ providerId: 'mock', provider: failing }), { ok: true, reason: null });
  assert.equal(resolved, 1);
});
