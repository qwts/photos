import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { createActivityFacade, mutateWithActivity } from '../../src/main/activity/activity-publication.js';
import { openLibraryDatabase } from '../../src/main/db/database.js';
import { run } from '../../src/main/db/sql.js';
import { PhotosRepository } from '../../src/main/db/photos-repository.js';
import { HistoryService } from '../../src/main/history/history-service.js';
import { LibraryService } from '../../src/main/library/library-service.js';

function world(onTrash?: () => void) {
  const db = openLibraryDatabase({
    path: join(mkdtempSync(join(tmpdir(), 'overlook-undo-')), 'library.db'),
    dbKey: randomBytes(32),
  });
  run(db, `INSERT INTO keys (id, wrapped_key, created_at) VALUES (1, 'w', ?)`, '2026-07-21T00:00:00.000Z');
  const repo = new PhotosRepository(db);
  for (const id of ['photo-one', 'photo-two']) {
    repo.insert({
      id,
      fileName: `${id}.jpg`,
      fileKind: 'jpeg',
      width: 10,
      height: 10,
      bytes: 100,
      contentHash: id.padEnd(64, '0'),
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
      importedAt: '2026-07-21T00:00:00.000Z',
      importSource: 'test',
      keyId: 1,
    });
  }
  const service = new LibraryService(db, { libraryChanged: () => undefined, pendingCountChanged: () => undefined });
  const activity = createActivityFacade(db, () => undefined);
  return { db, service, activity, history: new HistoryService(db, service, undefined, onTrash) };
}

describe('HistoryService (#615, ADR-0025)', () => {
  test('undoes and redoes favorites durably and idempotently', async () => {
    const state = world();
    mutateWithActivity(
      () => state.activity,
      () => state.service.toggleFavorite('photo-one'),
      (result) => ({
        eventType: 'photo.favorite-changed',
        entityIds: ['photo-one'],
        outcome: 'succeeded',
        payload: { favorite: result.favorite },
      }),
      (result) => ({
        commandId: 'photo.favorite.toggle',
        classification: 'immediately-reversible',
        inverse: { kind: 'favorite', photoId: 'photo-one', before: !result.favorite, after: result.favorite },
      }),
    );
    assert.equal(state.service.favoriteState('photo-one'), true);
    const undone = await state.history.undo('undo-favorite');
    assert.equal(undone.applied, true);
    assert.equal(state.service.favoriteState('photo-one'), false);
    assert.deepEqual(await new HistoryService(state.db, state.service).undo('undo-favorite'), undone);
    assert.equal((await state.history.redo('redo-favorite')).applied, true);
    assert.equal(state.service.favoriteState('photo-one'), true);
    state.db.close();
  });

  test('preserves exact album membership and Trash mutation sets', async () => {
    const state = world();
    state.service.createAlbum('album-one', 'One');
    state.service.addToAlbum('album-one', ['photo-one']);
    mutateWithActivity(
      () => state.activity,
      () => state.service.addToAlbum('album-one', ['photo-one', 'photo-two']),
      (result) => ({ eventType: 'album.membership-added', outcome: 'succeeded', payload: { count: result.added } }),
      (result) => ({
        commandId: 'album.membership.add',
        classification: 'immediately-reversible',
        inverse: {
          kind: 'album-membership',
          albumId: 'album-one',
          photoIds: result.changedPhotoIds,
          before: 'absent',
          after: 'present',
        },
      }),
    );
    await state.history.undo('undo-album');
    assert.equal(state.service.albumMembership('album-one', ['photo-one'])?.get('photo-one'), true, 'preexisting membership remains');
    assert.equal(state.service.albumMembership('album-one', ['photo-two'])?.get('photo-two'), false);

    mutateWithActivity(
      () => state.activity,
      () => state.service.deletePhotos(['photo-one', 'photo-two']),
      (result) => ({ eventType: 'photo.trashed', outcome: 'succeeded', payload: { count: result.deleted } }),
      (result) => ({
        commandId: 'photo.trash',
        classification: 'conditionally-reversible',
        inverse: { kind: 'trash', photoIds: result.changedPhotoIds, before: 'live', after: 'trashed' },
      }),
    );
    await state.history.undo('undo-trash');
    assert.deepEqual([...state.service.trashState(['photo-one', 'photo-two']).values()], ['live', 'live']);
    state.db.close();
  });

  test('undoes and redoes one committed album order and marks manifest debt (#225)', async () => {
    let manifestDebts = 0;
    const state = world(() => {
      manifestDebts += 1;
    });
    state.service.createAlbum('album-one', 'One');
    state.service.createAlbum('album-two', 'Two');
    state.service.createAlbum('album-three', 'Three');
    mutateWithActivity(
      () => state.activity,
      () => state.service.reorderAlbum('album-three', 0),
      () => ({ eventType: 'album.reordered', entityIds: ['album-three'], outcome: 'succeeded' }),
      (result) => ({
        commandId: 'album.reorder.top',
        classification: 'immediately-reversible',
        inverse: {
          kind: 'album-order',
          albumId: 'album-three',
          before: result.before,
          after: result.after,
        },
      }),
    );
    assert.deepEqual(state.service.albumOrder(), ['album-three', 'album-one', 'album-two']);

    assert.equal((await state.history.undo('undo-album-order')).applied, true);
    assert.deepEqual(state.service.albumOrder(), ['album-one', 'album-two', 'album-three']);
    assert.equal((await state.history.redo('redo-album-order')).applied, true);
    assert.deepEqual(state.service.albumOrder(), ['album-three', 'album-one', 'album-two']);
    assert.equal(manifestDebts, 2, 'undo and redo both refresh the manifest, including empty albums');
    state.db.close();
  });

  test('fails closed when a recorded resource disappears', async () => {
    const state = world();
    mutateWithActivity(
      () => state.activity,
      () => state.service.toggleFavorite('photo-one'),
      () => ({ eventType: 'photo.favorite-changed', outcome: 'succeeded' }),
      () => ({
        commandId: 'photo.favorite.toggle',
        classification: 'immediately-reversible',
        inverse: { kind: 'favorite', photoId: 'photo-one', before: false, after: true },
      }),
    );
    run(state.db, 'DELETE FROM photos WHERE id = ?', 'photo-one');
    const result = await state.history.undo('missing-photo');
    assert.equal(result.applied, false);
    assert.equal(result.capability.reason, 'resource-missing');
    state.db.close();
  });

  test('reports a deleted album as missing instead of consuming its command', async () => {
    const state = world();
    state.service.createAlbum('album-one', 'One');
    mutateWithActivity(
      () => state.activity,
      () => state.service.addToAlbum('album-one', ['photo-one']),
      () => ({ eventType: 'album.membership-added', outcome: 'succeeded' }),
      () => ({
        commandId: 'album.membership.add',
        classification: 'immediately-reversible',
        inverse: { kind: 'album-membership', albumId: 'album-one', photoIds: ['photo-one'], before: 'absent', after: 'present' },
      }),
    );
    state.service.deleteAlbum('album-one');
    const result = await state.history.undo('deleted-album');
    assert.equal(result.applied, false);
    assert.equal(result.capability.reason, 'resource-missing');
    state.db.close();
  });

  test('marks manifest debt when Redo moves restored photos back to Trash', async () => {
    let manifestDebts = 0;
    const state = world(() => {
      manifestDebts += 1;
    });
    mutateWithActivity(
      () => state.activity,
      () => state.service.deletePhotos(['photo-one']),
      () => ({ eventType: 'photo.trashed', outcome: 'succeeded' }),
      (result) => ({
        commandId: 'photo.trash',
        classification: 'conditionally-reversible',
        inverse: { kind: 'trash', photoIds: result.changedPhotoIds, before: 'live', after: 'trashed' },
      }),
    );
    await state.history.undo('restore-photo');
    assert.equal(manifestDebts, 0);
    await state.history.redo('retrash-photo');
    assert.equal(manifestDebts, 1);
    state.db.close();
  });
});
