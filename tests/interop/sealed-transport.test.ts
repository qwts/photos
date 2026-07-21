import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { z } from 'zod';

import {
  openInteropBlob,
  openInteropMessage,
  sealInteropBlob,
  sealInteropMessage,
  SealedInteropError,
  type InteropKeyCustody,
} from '../../src/main/interop/sealed-transport.js';
import { interopEnvelopeSchema } from '../../src/shared/interop/messages.js';
import {
  moveAcknowledgementPath,
  moveOriginalBlobPath,
  moveOutboxMessagePath,
} from '../../src/shared/interop/sealed-transport-contract.js';

const PAIRING_ID = 'a3267e90-2bd1-432c-bc8b-78e4704f843f';
const KEY_ID = 'interop:0de6557b-a17d-4e36-99f0-c20e64f021de';
const IV = Buffer.from('000102030405060708090a0b', 'hex');

const goldenTransportFixtureSchema = z.object({
  key: z.object({ pairingId: z.string(), keyId: z.string(), interopKey: z.string() }),
  iv: z.string(),
  message: z.object({ envelope: interopEnvelopeSchema, path: z.string(), sealed: z.string() }),
  blob: z.object({
    path: z.string(),
    descriptor: z.object({
      transferId: z.string(),
      recordInteropId: z.string(),
      blobId: z.string(),
      mimeType: z.string(),
      byteLength: z.number(),
      contentHash: z.string(),
    }),
    original: z.string(),
    sealed: z.string(),
  }),
});

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`design/handoff/contracts/v1/fixtures/${name}.json`, 'utf8')) as unknown;
}

function key(bytes = Buffer.from(Array.from({ length: 32 }, (_value, index) => index + 32))): InteropKeyCustody {
  return { pairingId: PAIRING_ID, keyId: KEY_ID, interopKey: bytes };
}

describe('sealed interop transport contract (#662)', () => {
  test('seals and opens a message with authenticated transfer identity', () => {
    const golden = goldenTransportFixtureSchema.parse(fixture('sealed-transport'));
    const envelope = golden.message.envelope;
    const custody = key(Buffer.from(golden.key.interopKey, 'base64'));
    const sealed = sealInteropMessage(envelope, custody, { iv: Buffer.from(golden.iv, 'base64') });
    assert.equal(sealed.toString('base64'), golden.message.sealed);
    assert.equal(moveAcknowledgementPath(envelope.header.sequence, envelope.header.messageId), golden.message.path);
    assert.deepEqual(openInteropMessage(Buffer.from(golden.message.sealed, 'base64'), custody), envelope);
    assert.deepEqual(openInteropMessage(sealed, key()), envelope);

    const corrupt = Buffer.from(sealed);
    corrupt[corrupt.length - 2] = (corrupt[corrupt.length - 2] ?? 0) ^ 1;
    assert.throws(() => openInteropMessage(corrupt, key()), SealedInteropError);
    assert.throws(() => openInteropMessage(sealed, key(Buffer.alloc(32, 9))), /could not be opened/u);
  });

  test('rejects IVs whose Base64 text length masks a non-96-bit nonce', () => {
    const golden = goldenTransportFixtureSchema.parse(fixture('sealed-transport'));
    const sealed = JSON.parse(Buffer.from(golden.message.sealed, 'base64').toString('utf8')) as {
      cipher: { iv: string };
    };
    sealed.cipher.iv = Buffer.alloc(10).toString('base64');
    assert.throws(() => openInteropMessage(Buffer.from(JSON.stringify(sealed), 'utf8'), key()), /Encrypted interop message is invalid/u);
  });

  test('keeps original metadata encrypted and verifies exact plaintext custody', () => {
    const golden = goldenTransportFixtureSchema.parse(fixture('sealed-transport'));
    const original = Buffer.from(golden.blob.original, 'base64');
    const recordInteropId = golden.blob.descriptor.recordInteropId;
    const blob = {
      state: 'available' as const,
      blobId: golden.blob.descriptor.blobId,
      mimeType: golden.blob.descriptor.mimeType,
      byteLength: golden.blob.descriptor.byteLength,
      contentHash: golden.blob.descriptor.contentHash,
    };
    const sealed = sealInteropBlob({
      key: key(),
      transferId: golden.blob.descriptor.transferId,
      recordInteropId,
      blob,
      bytes: original,
      options: { iv: IV },
    });
    assert.equal(createHash('sha256').update(original).digest('hex'), blob.contentHash);
    assert.equal(sealed.toString('base64'), golden.blob.sealed);
    assert.equal(moveOriginalBlobPath(recordInteropId), golden.blob.path);
    assert.doesNotMatch(sealed.toString('utf8'), /source-blob-1|image\/jpeg|0371f308/u);
    const opened = openInteropBlob(Buffer.from(golden.blob.sealed, 'base64'), key());
    assert.equal(opened.descriptor.transferId, golden.blob.descriptor.transferId);
    assert.equal(opened.descriptor.recordInteropId, recordInteropId);
    assert.deepEqual(opened.bytes, original);
    opened.bytes.fill(0);

    const corrupt = Buffer.from(sealed);
    corrupt[corrupt.length - 1] = (corrupt[corrupt.length - 1] ?? 0) ^ 1;
    assert.throws(() => openInteropBlob(corrupt, key()), /could not be opened/u);
    assert.throws(
      () =>
        sealInteropBlob({
          key: key(),
          transferId: golden.blob.descriptor.transferId,
          recordInteropId,
          blob,
          bytes: Buffer.from('wrong'),
          options: { iv: IV },
        }),
      /do not match/u,
    );
  });

  test('publishes traversal-free canonical Move object paths', () => {
    const messageId = '8959e5cc-391f-4330-9563-60f70bd0119d';
    const recordId = '4d220c3e-16bd-4833-891c-3ef9b980b3fb';
    assert.equal(moveOutboxMessagePath(1, messageId), `messages/outbox/000000000001-${messageId}.json.aesgcm`);
    assert.equal(moveAcknowledgementPath(1, messageId), `messages/acknowledgements/000000000001-${messageId}.json.aesgcm`);
    assert.equal(moveOriginalBlobPath(recordId), `blobs/${recordId}/original.bin.aesgcm`);
    assert.throws(() => moveOutboxMessagePath(-1, messageId), /sequence/u);
    assert.throws(() => moveOriginalBlobPath('../record'), /Invalid UUID/u);
  });
});
