import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildBackupManifestV2 } from '../../src/main/backup/backup-manifest.js';
import { SyncLedger } from '../../src/main/backup/sync-ledger.js';
import { openLibraryDatabase } from '../../src/main/db/database.js';
import { MIGRATIONS } from '../../src/main/db/migrations.js';
import { PhotosRepository } from '../../src/main/db/photos-repository.js';
import { run } from '../../src/main/db/sql.js';
import type { PhotoInsert } from '../../src/shared/library/types.js';

const CURRENT_DATABASE_SCHEMA = Math.max(...MIGRATIONS.map((migration) => migration.version));

function photo(id: string, hashByte: string, favorite = false): PhotoInsert {
  return {
    id,
    fileName: `${id}.JPG`,
    fileKind: 'jpeg',
    width: 10,
    height: 20,
    bytes: 42,
    contentHash: hashByte.repeat(64),
    camera: 'Camera',
    lens: null,
    iso: 100,
    aperture: '2.8',
    shutter: '1/125',
    focalLength: 35,
    takenAt: '2026-07-14T20:00:00.000Z',
    gpsLat: null,
    gpsLon: null,
    place: 'Chicago',
    importedAt: '2026-07-14T21:00:00.000Z',
    importSource: 'camera',
    favorite,
    keyId: 1,
  };
}

describe('recoverable manifest snapshot (#289)', () => {
  test('one transaction captures metadata, backed-up trash, albums, and membership', () => {
    const db = openLibraryDatabase({
      path: join(mkdtempSync(join(tmpdir(), 'overlook-manifest-snapshot-')), 'library.db'),
      dbKey: Buffer.alloc(32, 7),
    });
    run(db, `INSERT INTO keys (id, wrapped_key, created_at) VALUES (1, 'test', '2026-07-14T20:00:00.000Z')`);
    const repo = new PhotosRepository(db);
    const ledger = new SyncLedger(db);
    repo.insert(photo('P1', 'a', true));
    repo.insert(photo('P2', 'b'));
    repo.insert(photo('P3', 'c'));
    repo.createAlbum('A1', 'Trip');
    repo.addToAlbum('A1', ['P1', 'P2', 'P3']);
    repo.setPreviewFailure('P1', 'decode-failed');

    ledger.setStatus('P2', 'syncing');
    ledger.markBackedUp('P2', '2026-07-14T22:00:00.000Z');
    repo.softDelete(['P2', 'P3']);

    const manifest = buildBackupManifestV2({
      libraryId: '01JZZZZZZZZZZZZZZZZZZZZZZZ',
      generatedAt: '2026-07-14T23:00:00.000Z',
      snapshot: repo.manifestSnapshot(),
    });

    assert.equal(manifest.databaseSchema, CURRENT_DATABASE_SCHEMA);
    assert.deepEqual(manifest.keyIds, [1]);
    assert.deepEqual(
      manifest.photos.map(({ id, favorite, deletedAt, blobPath }) => ({ id, favorite, deletedAt: deletedAt !== null, blobPath })),
      [
        { id: 'P1', favorite: true, deletedAt: false, blobPath: `blobs/aa/${'a'.repeat(64)}` },
        { id: 'P2', favorite: false, deletedAt: true, blobPath: `blobs/bb/${'b'.repeat(64)}` },
      ],
      'live rows and remotely backed-up trash are recoverable; local-only trash is not promised',
    );
    assert.deepEqual(manifest.albums, [
      {
        id: 'A1',
        name: 'Trip',
        createdAt: manifest.albums[0]?.createdAt,
        position: 0,
        photoIds: ['P1', 'P2'],
      },
    ]);
    assert.deepEqual(manifest.totals, { photos: 2, bytes: 84, albums: 1 });
    assert.equal('previewFailure' in manifest.photos[0]!, false, 'local derivative state never enters disaster-recovery metadata');
  });

  test('an empty library produces a valid self-describing manifest', () => {
    const db = openLibraryDatabase({
      path: join(mkdtempSync(join(tmpdir(), 'overlook-empty-manifest-')), 'library.db'),
      dbKey: Buffer.alloc(32, 8),
    });
    const repo = new PhotosRepository(db);
    const manifest = buildBackupManifestV2({
      libraryId: '01JZZZZZZZZZZZZZZZZZZZZZZZ',
      generatedAt: '2026-07-14T23:00:00.000Z',
      snapshot: repo.manifestSnapshot(),
    });
    assert.deepEqual(manifest.keyIds, []);
    assert.deepEqual(manifest.totals, { photos: 0, bytes: 0, albums: 0 });
  });
});
