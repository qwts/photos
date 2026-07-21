import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { INTEROP_MEDIA_BLOCK_KEY, interopMediaBlockSchema, mediaBlockFrom, withMediaBlock } from '../../src/shared/interop/media-block.js';
import { interopRecordSchema } from '../../src/shared/interop/records.js';
import { translateImageTrailBookmark } from '../../src/main/interop/record-translation.js';

const BLOCK = {
  schemaVersion: 1,
  kind: 'gif',
  mimeType: 'image/gif',
  extension: 'gif',
  mediaInfo: { animated: true, frameCount: 3, loopCount: 0 },
} as const;

describe('interop media block (ADR-0026 §8, #547)', () => {
  test('rides in roundTripMetadata.overlook and round-trips', () => {
    const overlook = withMediaBlock({ note: 'kept' }, BLOCK);
    assert.deepEqual(mediaBlockFrom(overlook), BLOCK);
    assert.equal(overlook['note'], 'kept', 'other product keys preserved');
  });

  test('absent, invalid, or foreign-shaped values read as null, never a throw', () => {
    assert.equal(mediaBlockFrom({}), null);
    assert.equal(mediaBlockFrom({ [INTEROP_MEDIA_BLOCK_KEY]: 'gif' }), null);
    assert.equal(mediaBlockFrom({ [INTEROP_MEDIA_BLOCK_KEY]: { schemaVersion: 2, kind: 'gif', mimeType: 'image/gif' } }), null);
  });

  test('null strips the block without touching other keys', () => {
    const overlook = withMediaBlock(withMediaBlock({ keep: 1 }, BLOCK), null);
    assert.deepEqual(overlook, { keep: 1 });
  });

  test('playability never crosses the wire — unknown keys are rejected (§3)', () => {
    assert.throws(() => interopMediaBlockSchema.parse({ ...BLOCK, playable: true }));
  });

  test('a v1 record carrying the block still satisfies the STRICT v1 schema', () => {
    const record = translateImageTrailBookmark({
      uuid: '3f2c6f60-0000-4000-8000-000000000001',
      payload: {
        url: 'https://example.com/party.gif',
        bookmarkedAt: '2026-07-14T22:00:00.000Z',
        storedOriginal: {
          blobId: 'blob-1',
          mimeType: 'image/gif',
          byteLength: 255,
          capturedAt: '2026-07-14T22:00:00.000Z',
        },
      },
    });
    const carrying = {
      ...record,
      roundTripMetadata: { ...record.roundTripMetadata, overlook: withMediaBlock(record.roundTripMetadata.overlook, BLOCK) },
    };
    const parsed = interopRecordSchema.parse(JSON.parse(JSON.stringify(carrying)));
    assert.deepEqual(mediaBlockFrom(parsed.roundTripMetadata.overlook), BLOCK);
    assert.equal(parsed.original.mimeType, 'image/gif', 'original MIME preserved verbatim');
  });
});
