import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ALBUM_REORDER_DRAG_TYPE, decodeAlbumReorderDrag, encodeAlbumReorderDrag } from '../../src/shared/library/album-reorder-drag.js';

describe('album reorder drag payload (#225)', () => {
  test('uses a distinct MIME type and round-trips a versioned album id', () => {
    assert.equal(ALBUM_REORDER_DRAG_TYPE, 'application/x-overlook-album-reorder');
    assert.deepEqual(decodeAlbumReorderDrag(encodeAlbumReorderDrag({ version: 1, albumId: 'album-one' })), {
      version: 1,
      albumId: 'album-one',
    });
  });

  test('rejects malformed, empty, and future payloads', () => {
    for (const value of ['', '{}', '{', '[]', '{"version":2,"albumId":"album-one"}', '{"version":1,"albumId":""}']) {
      assert.equal(decodeAlbumReorderDrag(value), null);
    }
  });
});
