import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openLibraryDatabase } from '../../src/main/db/database.js';
import { run } from '../../src/main/db/sql.js';
import { PhotosRepository } from '../../src/main/db/photos-repository.js';
import type { PhotoInsert } from '../../src/shared/library/types.js';

// #120: delete is safe by default. Soft-deleted rows live ONLY in the trash
// source, leave pendingCount and the upload queue, and restore intact
// (favorite, EXIF, ledger status) while re-dirtying for the next manifest.

let seq = 0;
function photo(overrides: Partial<PhotoInsert> = {}): PhotoInsert {
  seq += 1;
  const n = String(seq).padStart(6, '0');
  return {
    id: `01J8TRASH${n}`,
    fileName: `IMG_${n}.JPG`,
    fileKind: 'jpeg',
    width: 100,
    height: 100,
    bytes: 1000,
    contentHash: `trash-hash-${n}`,
    camera: 'FUJIFILM X-T5',
    lens: null,
    iso: null,
    aperture: null,
    shutter: null,
    focalLength: null,
    takenAt: null,
    gpsLat: null,
    gpsLon: null,
    place: null,
    importedAt: '2026-06-01T00:00:00.000Z',
    importSource: 'test',
    keyId: 1,
    ...overrides,
  };
}

function world(): { repo: PhotosRepository; db: ReturnType<typeof openLibraryDatabase>; ids: string[] } {
  const db = openLibraryDatabase({ path: join(mkdtempSync(join(tmpdir(), 'overlook-trash-')), 'library.db'), dbKey: randomBytes(32) });
  run(db, `INSERT INTO keys (id, wrapped_key, created_at) VALUES (1, 'test', '2026-01-01T00:00:00.000Z')`);
  const repo = new PhotosRepository(db);
  repo.insert(photo({ favorite: true }));
  repo.insert(photo());
  const ids = repo.page({ source: 'all', limit: 10 }).photos.map((row) => row.id);
  return { repo, db, ids };
}

describe('soft delete + restore (#120)', () => {
  test('EXIT CRITERIA: delete → only in trash; every other source excludes it', () => {
    const { repo, db } = world();
    const target = repo.page({ source: 'favorites', limit: 1 }).photos[0]?.id ?? '';
    assert.deepEqual(repo.softDelete([target]), [target]);
    assert.equal(repo.page({ source: 'all', limit: 10 }).photos.length, 1);
    assert.equal(repo.page({ source: 'favorites', limit: 10 }).photos.length, 0, 'the deleted favorite left Favorites');
    assert.deepEqual(
      repo.page({ source: 'deleted', limit: 10 }).photos.map((row) => row.id),
      [target],
    );
    assert.equal(repo.counts('2026-01-01T00:00:00.000Z').deleted, 1);
    db.close();
  });

  test('deleted rows leave pendingCount and the upload queue; restore re-dirties', () => {
    const { repo, db, ids } = world();
    const target = ids[0] ?? '';
    assert.equal(repo.pendingCount(), 2, 'both born dirty');
    repo.softDelete([target]);
    assert.equal(repo.pendingCount(), 1, 'the deleted row left the pending count');
    assert.equal(
      repo.dirtyPhotos().some((row) => row.id === target),
      false,
      'and the upload queue',
    );

    repo.restore([target]);
    assert.equal(repo.pendingCount(), 2, 'restore re-dirties');
    assert.equal(
      repo.dirtyPhotos().some((row) => row.id === target),
      true,
    );
    db.close();
  });

  test('EXIT CRITERIA: restore returns the row intact — favorite and ledger status survive', () => {
    const { repo, db } = world();
    const target = repo.page({ source: 'favorites', limit: 1 }).photos[0]?.id ?? '';
    run(db, `UPDATE sync_ledger SET status = 'synced', dirty = 0 WHERE photo_id = ?`, target);
    repo.softDelete([target]);
    assert.deepEqual(repo.restore([target]), [target]);
    const back = repo.get(target);
    assert.equal(back?.favorite, true, 'favorite intact');
    assert.equal(back?.syncState, 'synced', 'ledger status intact');
    assert.equal(back?.deletedAt, null);
    db.close();
  });

  test('idempotent both ways: re-deleting and re-restoring are no-ops', () => {
    const { repo, db, ids } = world();
    const target = ids[0] ?? '';
    assert.deepEqual(repo.restore([target]), [], 'restoring a live row is a no-op');
    repo.softDelete([target]);
    assert.deepEqual(repo.softDelete([target]), [], 're-deleting is a no-op');
    assert.deepEqual(repo.softDelete(['GHOST']), [], 'unknown ids are skipped, not errors');
    db.close();
  });
});
