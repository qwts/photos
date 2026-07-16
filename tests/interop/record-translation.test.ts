import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  deterministicInteropId,
  translateImageTrailAlbum,
  translateImageTrailBookmark,
} from '../../src/main/interop/record-translation.js';

const BOOKMARK = {
  uuid: 'bookmark-legacy-1',
  payload: {
    url: 'https://example.test/photo.jpg',
    title: 'Reference',
    label: 'Blue',
    thumbnail: 'data:image/jpeg;base64,AQID',
    width: 1200,
    height: 800,
    bookmarkedAt: '2026-07-16T13:00:00.000Z',
    downloadedAt: '2026-07-16T13:02:00.000Z',
    capturedAt: '2026-07-16T13:05:00.000Z',
    sourceCompatibility: 'favorites',
    storedOriginal: {
      blobId: 'original-1',
      mimeType: 'image/jpeg',
      byteLength: 42,
      capturedAt: '2026-07-16T13:05:00.000Z',
    },
    protectedPin: {
      schemaVersion: 1,
      plainPinId: 'bookmark-legacy-1',
      queueUpdatedAt: '2026-07-16T13:06:00.000Z',
      hasEncryptedMetadata: true,
      hasEncryptedThumbnail: true,
      hasStoredOriginal: true,
    },
    futureImageTrailField: { retained: true },
  },
} as const;

describe('Image Trail record translation', () => {
  test('creates a stable canonical metadata record without fabricating camera semantics', () => {
    const first = translateImageTrailBookmark(BOOKMARK);
    const second = translateImageTrailBookmark(BOOKMARK);

    assert.deepEqual(first, second);
    assert.equal(first.identity.interopId, deterministicInteropId('image-trail', BOOKMARK.uuid));
    assert.deepEqual(first.identity, {
      interopId: first.identity.interopId,
      origin: { product: 'image-trail', localId: BOOKMARK.uuid },
      contentHash: null,
    });
    assert.equal(first.recordKind, 'web-bookmark');
    assert.deepEqual(first.dimensions, { width: 1200, height: 800 });
    assert.deepEqual(first.timestamps, {
      bookmarkedAt: '2026-07-16T13:00:00.000Z',
      capturedAt: '2026-07-16T13:05:00.000Z',
      downloadedAt: '2026-07-16T13:02:00.000Z',
      takenAt: null,
      importedAt: null,
    });
    assert.deepEqual(first.original, {
      state: 'unavailable',
      blobId: null,
      mimeType: 'image/jpeg',
      byteLength: 42,
      contentHash: null,
      reason: 'provider-unavailable',
    });
    assert.equal(first.thumbnail.state, 'metadata-only');
    assert.equal(first.roundTripMetadata.imageTrail['futureImageTrailField'] !== undefined, true);
    assert.equal(first.roundTripMetadata.imageTrail['protectedPin'] !== undefined, true);
  });

  test('does not treat bookmark time as capture time and only accepts complete dimensions', () => {
    const record = translateImageTrailBookmark({
      uuid: 'metadata-only',
      payload: { url: 'https://example.test/reference', width: 100, bookmarkedAt: '2026-07-16T13:00:00Z' },
    });
    assert.equal(record.dimensions, null);
    assert.equal(record.timestamps.bookmarkedAt, '2026-07-16T13:00:00.000Z');
    assert.equal(record.timestamps.capturedAt, null);
    assert.equal(record.timestamps.takenAt, null);
    assert.equal(record.original.state, 'metadata-only');
  });

  test('translates albums with stable identities and ordered known memberships', () => {
    const recordId = deterministicInteropId('image-trail', BOOKMARK.uuid);
    const album = translateImageTrailAlbum(
      {
        id: 'album-legacy-1',
        name: 'Reference',
        createdAt: '2026-07-16T12:00:00.000Z',
        updatedAt: '2026-07-16T13:00:00.000Z',
        recordIds: ['missing', BOOKMARK.uuid],
      },
      new Map([[BOOKMARK.uuid, recordId]]),
    );

    assert.equal(album.interopId, deterministicInteropId('image-trail-album', 'album-legacy-1'));
    assert.deepEqual(album.members, [{ recordInteropId: recordId, position: 1, revision: { imageTrail: 1, overlook: 0 } }]);
    assert.deepEqual(album.roundTripMetadata.imageTrail['recordIds'], ['missing', BOOKMARK.uuid]);
  });
});
