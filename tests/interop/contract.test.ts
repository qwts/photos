import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  INTEROP_CONTRACT_VERSION,
  INTEROP_MAGIC,
  interopConflictActionSchema,
  interopHeaderSchema,
  interopIdentitySchema,
  interopReviewCategorySchema,
} from '../../src/shared/interop/contract.js';
import { interopEnvelopeSchema } from '../../src/shared/interop/messages.js';
import { compareInteropRevisions, incrementInteropRevision, mergeInteropRevisions } from '../../src/shared/interop/revisions.js';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`design/handoff/contracts/v1/fixtures/${name}`, 'utf8')) as unknown;
}

const header = {
  magic: INTEROP_MAGIC,
  contractVersion: INTEROP_CONTRACT_VERSION,
  messageId: '8959e5cc-391f-4330-9563-60f70bd0119d',
  transferId: '8c42634d-d602-46ee-ac5b-20186fbd51e0',
  pairingId: 'a3267e90-2bd1-432c-bc8b-78e4704f843f',
  sourceProduct: 'image-trail',
  targetProduct: 'overlook',
  operation: 'move',
  kind: 'manifest',
  createdAt: '2026-07-16T10:00:00.000Z',
  sequence: 0,
} as const;

describe('interoperability contract primitives', () => {
  test('accepts a cross-product version-one header and rejects same-product or future-version messages', () => {
    assert.deepEqual(interopHeaderSchema.parse(header), header);
    assert.equal(interopHeaderSchema.safeParse({ ...header, targetProduct: 'image-trail' }).success, false);
    assert.equal(interopHeaderSchema.safeParse({ ...header, contractVersion: 2 }).success, false);
    assert.equal(interopHeaderSchema.safeParse({ ...header, unknown: true }).success, false);
  });

  test('requires identity rather than accepting filename-only deduplication', () => {
    const identity = {
      interopId: '4d220c3e-16bd-4833-891c-3ef9b980b3fb',
      origin: { product: 'overlook', localId: '01JPHOTORECORD' },
      contentHash: 'a'.repeat(64),
    } as const;
    assert.deepEqual(interopIdentitySchema.parse(identity), identity);
    assert.equal(interopIdentitySchema.safeParse({ fileName: 'duplicate.jpg' }).success, false);
    assert.equal(interopIdentitySchema.safeParse({ ...identity, contentHash: 'duplicate.jpg' }).success, false);
  });

  test('publishes the exact shared review and conflict vocabulary', () => {
    assert.deepEqual(interopReviewCategorySchema.options, ['eligible', 'duplicate', 'conflict', 'metadata-only', 'unsupported', 'skipped']);
    assert.deepEqual(interopConflictActionSchema.options, ['keep-image-trail', 'keep-overlook', 'keep-both']);
  });

  test('parses the canonical record fixture and rejects the future-version fixture', () => {
    const parsed = interopEnvelopeSchema.parse(fixture('valid-record-message.json'));
    assert.equal(parsed.payload.kind, 'record');
    assert.equal(parsed.payload.kind === 'record' && parsed.payload.record.original.state, 'metadata-only');
    assert.equal(interopEnvelopeSchema.safeParse(fixture('rejected-future-version.json')).success, false);
  });

  test('rejects a mismatched header/payload kind and unsafe blob transport paths', () => {
    const valid = fixture('valid-record-message.json');
    assert.equal(
      interopEnvelopeSchema.safeParse({
        ...(valid as object),
        header: { ...(valid as { header: object }).header, kind: 'manifest' },
      }).success,
      false,
    );
    const blobMessage = {
      ...(valid as { header: object; payload: object }),
      header: { ...(valid as { header: object }).header, kind: 'blob' },
      payload: {
        kind: 'blob',
        schemaVersion: 1,
        recordInteropId: '4d220c3e-16bd-4833-891c-3ef9b980b3fb',
        role: 'original',
        blob: {
          state: 'available',
          blobId: 'original-123',
          mimeType: 'image/jpeg',
          byteLength: 42,
          contentHash: 'c'.repeat(64),
        },
        encryptedPath: '../backup/original.bin',
        chunkIndex: 0,
        chunkCount: 1,
      },
    };
    assert.equal(interopEnvelopeSchema.safeParse(blobMessage).success, false);
  });
});

describe('interoperability revision vectors', () => {
  test('distinguishes ordered, equal, and concurrent revisions', () => {
    assert.equal(compareInteropRevisions({ imageTrail: 1, overlook: 2 }, { imageTrail: 1, overlook: 2 }), 'equal');
    assert.equal(compareInteropRevisions({ imageTrail: 1, overlook: 2 }, { imageTrail: 2, overlook: 2 }), 'before');
    assert.equal(compareInteropRevisions({ imageTrail: 3, overlook: 2 }, { imageTrail: 2, overlook: 2 }), 'after');
    assert.equal(compareInteropRevisions({ imageTrail: 3, overlook: 1 }, { imageTrail: 2, overlook: 2 }), 'concurrent');
  });

  test('increments one actor without mutating the input and merges by component maximum', () => {
    const initial = { imageTrail: 4, overlook: 7 };
    assert.deepEqual(incrementInteropRevision(initial, 'image-trail'), { imageTrail: 5, overlook: 7 });
    assert.deepEqual(incrementInteropRevision(initial, 'overlook'), { imageTrail: 4, overlook: 8 });
    assert.deepEqual(initial, { imageTrail: 4, overlook: 7 });
    assert.deepEqual(mergeInteropRevisions({ imageTrail: 5, overlook: 3 }, { imageTrail: 2, overlook: 8 }), {
      imageTrail: 5,
      overlook: 8,
    });
  });
});
