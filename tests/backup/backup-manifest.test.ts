import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKUP_MANIFEST_SCHEMA_VERSION,
  BackupManifestError,
  backupManifestV2Schema,
  parseBackupManifest,
  type BackupManifestV2,
} from '../../src/main/backup/backup-manifest.js';

const HASH = 'ab'.repeat(32);

function manifest(): BackupManifestV2 {
  return {
    schema: BACKUP_MANIFEST_SCHEMA_VERSION,
    libraryId: '01JZZZZZZZZZZZZZZZZZZZZZZZ',
    databaseSchema: 3,
    generatedAt: '2026-07-14T23:00:00.000Z',
    keyIds: [1],
    totals: { photos: 1, bytes: 42, albums: 1 },
    photos: [
      {
        id: 'P1',
        fileName: 'IMG_0001.JPG',
        fileKind: 'jpeg',
        width: 10,
        height: 20,
        bytes: 42,
        contentHash: HASH,
        blobPath: `blobs/ab/${HASH}`,
        camera: 'Camera',
        lens: null,
        iso: 100,
        aperture: 'f/2.8',
        shutter: '1/125',
        focalLength: 35,
        takenAt: '2026-07-14T22:00:00.000Z',
        gpsLat: 41.88,
        gpsLon: -87.63,
        place: 'Chicago',
        importedAt: '2026-07-14T22:30:00.000Z',
        importSource: 'camera',
        favorite: true,
        keyId: 1,
        deletedAt: null,
      },
    ],
    albums: [
      {
        id: 'A1',
        name: 'Favorites',
        createdAt: '2026-07-14T22:45:00.000Z',
        position: 0,
        photoIds: ['P1'],
      },
    ],
  };
}

describe('backup manifest schema (#289)', () => {
  test('schema 2 round-trips complete recoverable photo and album state', () => {
    const source = manifest();
    assert.deepEqual(backupManifestV2Schema.parse(JSON.parse(JSON.stringify(source))), source);
    assert.deepEqual(parseBackupManifest(source), { restorable: true, manifest: source });
  });

  test('schema 1 remains parseable but is explicitly not fully restorable', () => {
    const legacy = {
      schema: 1 as const,
      rows: [{ id: 'P1', contentHash: HASH, bytes: 42, fileName: 'IMG_0001.JPG', keyId: 1 }],
    };
    assert.deepEqual(parseBackupManifest(legacy), { restorable: false, manifest: legacy });
  });

  test('cross-record inconsistencies fail validation', () => {
    const source = manifest();
    assert.throws(
      () =>
        parseBackupManifest({
          ...source,
          keyIds: [2],
          totals: { ...source.totals, bytes: 41 },
          albums: [{ ...source.albums[0], photoIds: ['missing'] }],
        }),
      (error: unknown) => {
        assert.ok(error instanceof BackupManifestError);
        assert.match(error.message, /photo key is missing/u);
        assert.match(error.message, /byte total does not match/u);
        assert.match(error.message, /album member is missing/u);
        return true;
      },
    );
  });

  test('blob references are derived from the content hash, never arbitrary provider paths', () => {
    const source = manifest();
    assert.throws(
      () => parseBackupManifest({ ...source, photos: [{ ...source.photos[0], blobPath: '../escape' }] }),
      /blob path does not match/u,
    );
  });

  test('unknown schemas fail closed', () => {
    assert.throws(() => parseBackupManifest({ schema: 3 }), /unsupported manifest schema 3/u);
  });
});
