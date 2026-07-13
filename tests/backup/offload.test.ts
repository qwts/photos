import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { BlobStore } from '../../src/main/blobs/blob-store.js';
import { BackupEngine, type BackupEngineDeps } from '../../src/main/backup/backup-engine.js';
import { MockProvider } from '../../src/main/backup/mock-provider.js';
import { OffloadService, RehydrateError } from '../../src/main/backup/offload.js';
import { SyncLedger } from '../../src/main/backup/sync-ledger.js';
import { openLibraryDatabase } from '../../src/main/db/database.js';
import { PhotosRepository } from '../../src/main/db/photos-repository.js';
import { run } from '../../src/main/db/sql.js';
import { sampleJpeg } from '../../src/main/library/seed.js';
import type { EnvelopeKey } from '../../src/main/crypto/envelope.js';
import type { PhotoInsert } from '../../src/shared/library/types.js';

// #107: originals live only in the cloud, safely, and come back when
// needed — over the REAL store/ledger/provider, backed up by the REAL
// engine first (eligibility trusts #106's verified bit).

async function world(count: number) {
  const dataDir = mkdtempSync(join(tmpdir(), 'overlook-offload-'));
  const db = openLibraryDatabase({ path: join(dataDir, 'library.db'), dbKey: randomBytes(32) });
  run(db, `INSERT OR IGNORE INTO keys (id, wrapped_key, created_at) VALUES (1, 'test', '2026-07-13T00:00:00.000Z')`);
  const repo = new PhotosRepository(db);
  const store = new BlobStore({ dataDir });
  await store.init();
  const key: EnvelopeKey = { id: 1, key: randomBytes(32) };
  const plaintexts = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    const bytes = sampleJpeg(index);
    const ref = await store.putOriginal(Readable.from([bytes]), key, `P${String(index)}`);
    await store.putThumb(Readable.from([bytes]), key, `P${String(index)}`, ref.contentHash, 'thumb');
    plaintexts.set(`P${String(index)}`, bytes);
    repo.insert({
      id: `P${String(index)}`,
      fileName: `IMG_${String(index)}.JPG`,
      fileKind: 'jpeg',
      width: 1,
      height: 1,
      bytes: ref.bytes,
      contentHash: ref.contentHash,
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
      importedAt: `2026-07-13T00:0${String(index % 10)}:00.000Z`,
      importSource: 'test',
      keyId: 1,
    } satisfies PhotoInsert);
  }
  const provider = new MockProvider({ rootDir: mkdtempSync(join(tmpdir(), 'overlook-remote-')) });
  const ledger = new SyncLedger(db);
  const audits: string[] = [];
  const engineDeps: BackupEngineDeps = {
    provider,
    ledger,
    dirtyPhotos: () => repo.dirtyPhotos(),
    encryptedStream: (hash) => store.getEncryptedStream(hash),
    sealManifest: (json) => Promise.resolve(Buffer.from(json)),
    manifestRows: () => repo.manifestRows(),
    settings: () => ({ throttlePercent: null, wifiOnly: false, autoBackupOnImport: false }),
    network: () => 'wifi',
    events: { progress: () => undefined },
    now: () => Date.parse('2026-07-13T03:00:00.000Z'),
    sleep: () => Promise.resolve(),
    pendingCountChanged: () => undefined,
    libraryChanged: () => undefined,
    audit: (line) => audits.push(line),
  };
  const changed: string[][] = [];
  const service = new OffloadService({
    provider,
    ledger,
    repo: {
      get: (id) => repo.get(id),
      countByContentHash: (hash) => repo.countByContentHash(hash),
    },
    ledgerDirty: (photoId) => ledger.isDirty(photoId),
    blobs: {
      deleteOriginal: async (hash) => store.deleteOriginal(hash),
      hasOriginal: (hash) => store.hasOriginal(hash),
      restoreOriginal: async (hash, ciphertext, photoId) => store.restoreOriginal(hash, ciphertext, () => key.key, photoId),
    },
    libraryChanged: (ids) => changed.push([...ids]),
    audit: (line) => audits.push(line),
  });
  return { db, repo, store, provider, ledger, key, plaintexts, audits, changed, service, engine: new BackupEngine(engineDeps) };
}

describe('offload + rehydrate (#107)', () => {
  test('EXIT CRITERIA: verified-synced offloads — original gone, THUMBS STAY, stats shift', async () => {
    const w = await world(2);
    await w.engine.run();
    const photo = w.repo.get('P0');
    assert.notEqual(photo, undefined);

    const summary = await w.service.offload(['P0']);
    assert.deepEqual({ offloaded: summary.offloaded, skipped: summary.skipped }, { offloaded: 1, skipped: 0 });
    assert.equal(summary.freedBytes, photo?.bytes);
    assert.equal(w.ledger.status('P0'), 'offloaded');
    assert.equal(w.store.hasOriginal(photo?.contentHash ?? ''), false, 'original evicted');
    // Thumbs stay: the grid keeps browsing offline (ADR-0007).
    const thumb = await buffer(w.store.getThumbStream(photo?.contentHash ?? '', 'thumb', () => w.key.key, 'P0'));
    assert.deepEqual(thumb, w.plaintexts.get('P0'));
    assert.equal(w.repo.stats().offloadedBytes, photo?.bytes, 'the sidebar split sees it');
    assert.deepEqual(w.changed, [['P0']], 'tiles get their targeted push');
  });

  test('ineligible rows are skipped, never forced: dirty, unsynced, unknown', async () => {
    const w = await world(2);
    await w.engine.run();
    w.ledger.markDirty('P0'); // synced but dirty again — not eligible
    const summary = await w.service.offload(['P0', 'GHOST']);
    assert.deepEqual({ offloaded: summary.offloaded, skipped: summary.skipped }, { offloaded: 0, skipped: 2 });
    assert.equal(w.store.hasOriginal(w.repo.get('P0')?.contentHash ?? ''), true);
  });

  test('EXIT CRITERIA: rehydrate restores byte-identical, verifies, and flips synced', async () => {
    const w = await world(1);
    await w.engine.run();
    await w.service.offload(['P0']);
    const photo = w.repo.get('P0');
    assert.equal(w.store.hasOriginal(photo?.contentHash ?? ''), false);

    await w.service.rehydrate('P0');
    assert.equal(w.ledger.status('P0'), 'synced');
    const restored = await buffer(w.store.getStream(photo?.contentHash ?? '', () => w.key.key, 'P0'));
    assert.deepEqual(restored, w.plaintexts.get('P0'), 'plaintext round-trips through the cloud');
    assert.ok(w.audits.some((line) => line.startsWith('REHYDRATE-OK photo=P0')));
  });

  test('a corrupt download never publishes: record stays cleanly offloaded', async () => {
    const w = await world(1);
    await w.engine.run();
    await w.service.offload(['P0']);
    const photo = w.repo.get('P0');
    // Corrupt the remote copy — the restore must verify and refuse.
    await w.provider.put(
      `blobs/${photo?.contentHash.slice(0, 2) ?? ''}/${photo?.contentHash ?? ''}`,
      Readable.from([Buffer.from('garbage')]),
    );

    await assert.rejects(w.service.rehydrate('P0'), RehydrateError);
    assert.equal(w.ledger.status('P0'), 'offloaded', 'status untouched');
    assert.equal(w.store.hasOriginal(photo?.contentHash ?? ''), false, 'no half-restored blob');
    assert.ok(w.audits.some((line) => line.startsWith('REHYDRATE-FAIL photo=P0')));
  });

  test('rehydrating a non-offloaded photo is a typed error', async () => {
    const w = await world(1);
    await assert.rejects(w.service.rehydrate('P0'), RehydrateError);
  });
});
