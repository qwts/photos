import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { decodePhotoDrag, encodePhotoDrag, type PhotoDragPayload } from '../../src/shared/library/photo-drag.js';
import {
  beginPhotoDrag,
  endPhotoDrag,
  hasPhotoDrag,
  readPhotoDrag,
  type PhotoDragDataTransfer,
} from '../../src/renderer/src/grid/photo-drag-session.js';

function fakeDataTransfer(): PhotoDragDataTransfer {
  const data = new Map<string, string>();
  return {
    effectAllowed: 'uninitialized',
    get types() {
      return [...data.keys()];
    },
    getData: (type: string) => data.get(type) ?? '',
    setData: (type: string, value: string) => data.set(type, value),
  };
}

describe('internal photo drag contract (#279)', () => {
  test('round-trips a bounded selection and source album', () => {
    const payload: PhotoDragPayload = { version: 1, photoIds: ['P1', 'P2'], sourceAlbumId: 'A1' };
    assert.deepEqual(decodePhotoDrag(encodePhotoDrag(payload)), payload);
    assert.deepEqual(decodePhotoDrag('{"version":1,"photoIds":["P1","P1"],"sourceAlbumId":null}'), {
      version: 1,
      photoIds: ['P1'],
      sourceAlbumId: null,
    });
  });

  test('rejects malformed, empty, oversized, and unsupported payloads', () => {
    assert.equal(decodePhotoDrag('not json'), null);
    assert.equal(decodePhotoDrag('{"version":2,"photoIds":["P1"],"sourceAlbumId":null}'), null);
    assert.equal(decodePhotoDrag('{"version":1,"photoIds":[],"sourceAlbumId":null}'), null);
    assert.equal(
      decodePhotoDrag(JSON.stringify({ version: 1, photoIds: Array.from({ length: 10_001 }, () => 'P'), sourceAlbumId: null })),
      null,
    );
    assert.equal(decodePhotoDrag('{"version":1,"photoIds":[1],"sourceAlbumId":null}'), null);
  });

  test('rejects an oversized same-window payload before caching it', () => {
    const transfer = fakeDataTransfer();
    beginPhotoDrag(transfer, {
      version: 1,
      photoIds: Array.from({ length: 10_001 }, (_, index) => `P${index}`),
      sourceAlbumId: null,
    });
    assert.equal(transfer.effectAllowed, 'none');
    assert.equal(hasPhotoDrag(transfer), false);
    assert.equal(readPhotoDrag(transfer), null);
    endPhotoDrag();
  });
});
