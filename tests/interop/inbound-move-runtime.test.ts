import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { openLibraryDatabase } from '../../src/main/db/database.js';
import { InboundMoveObjectJournal } from '../../src/main/interop/inbound-move-object-journal.js';
import { InboundMoveRuntime } from '../../src/main/interop/inbound-move-runtime.js';
import { MoveJournalRepository } from '../../src/main/interop/move-journal-repository.js';
import type { InteropKeyCustody } from '../../src/main/interop/pairing-custody.js';
import { openInteropMessage, sealInteropBlob, sealInteropMessage } from '../../src/main/interop/sealed-transport.js';
import { EncryptedInteropTransport, type InteropObjectPage, type InteropObjectStore } from '../../src/main/interop/transport.js';
import { INTEROP_CONTRACT_VERSION, INTEROP_MAGIC } from '../../src/shared/interop/contract.js';
import { interopEnvelopeSchema, type InteropEnvelope } from '../../src/shared/interop/messages.js';
import { interopRecordSchema } from '../../src/shared/interop/records.js';
import {
  moveAcknowledgementPath,
  moveOriginalBlobPath,
  moveOutboxMessagePath,
} from '../../src/shared/interop/sealed-transport-contract.js';

const PAIRING_ID = '56d15daa-4f24-466c-b20d-69b78e8320f6';
const TRANSFER_ID = '48ced8d7-2f3a-4b60-967f-8f1c27867e65';
const RECORD_ID = 'bf1842f7-56b2-4d84-a7b1-b3bedcddf97b';
const RECORD_MESSAGE_ID = '6af6239d-8ce9-4ac8-b9ca-ffb0e55635cf';
const BLOB_MESSAGE_ID = 'c8865ad8-8975-4abe-9a1c-bbde10a71efa';
const ACK_MESSAGE_ID = '07a69c07-6947-4f72-a82d-45505c376cb4';
const CUSTODY: InteropKeyCustody = {
  pairingId: PAIRING_ID,
  keyId: `interop:${PAIRING_ID}`,
  interopKey: randomBytes(32),
};

class MemoryStore implements InteropObjectStore {
  readonly provider = 'pcloud' as const;
  readonly values = new Map<string, Buffer>();
  failAcknowledgementOnce = false;

  authState(): Promise<'connected'> {
    return Promise.resolve('connected');
  }
  put(path: string, bytes: Buffer): Promise<{ readonly bytes: number }> {
    if (this.failAcknowledgementOnce && path.includes('/messages/acknowledgements/') && path.endsWith('.manifest.json')) {
      this.failAcknowledgementOnce = false;
      return Promise.reject(new Error('injected acknowledgement upload failure'));
    }
    this.values.set(path, Buffer.from(bytes));
    return Promise.resolve({ bytes: bytes.length });
  }
  get(path: string): Promise<Buffer> {
    const value = this.values.get(path);
    return value === undefined ? Promise.reject(new Error(`missing ${path}`)) : Promise.resolve(Buffer.from(value));
  }
  list(prefix: string, cursor: string | null): Promise<InteropObjectPage> {
    assert.equal(cursor, null);
    const entries = [...this.values.entries()]
      .filter(([path]) => path.startsWith(prefix) && path.endsWith('.manifest.json'))
      .map(([path, bytes]) => ({ path, bytes: bytes.length }));
    return Promise.resolve({ entries, nextCursor: null });
  }
  delete(path: string): Promise<void> {
    this.values.delete(path);
    return Promise.resolve();
  }
  quota(): Promise<{ readonly usedBytes: number; readonly totalBytes: null }> {
    return Promise.resolve({ usedBytes: 0, totalBytes: null });
  }
  verify(path: string): Promise<{ readonly sha256: string; readonly bytes: number }> {
    const value = this.values.get(path);
    if (value === undefined) return Promise.resolve({ sha256: '0'.repeat(64), bytes: -1 });
    return Promise.resolve({ sha256: createHash('sha256').update(value).digest('hex'), bytes: value.length });
  }
}

function originalBytes(): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('runtime-original')]);
}

function header(messageId: string, kind: 'record' | 'blob', sequence: number) {
  return {
    magic: INTEROP_MAGIC,
    contractVersion: INTEROP_CONTRACT_VERSION,
    messageId,
    transferId: TRANSFER_ID,
    pairingId: PAIRING_ID,
    sourceProduct: 'image-trail' as const,
    targetProduct: 'overlook' as const,
    operation: 'move' as const,
    kind,
    createdAt: '2026-07-21T18:00:00.000Z',
    sequence,
  };
}

function sourceMessages(): { readonly record: InteropEnvelope; readonly blob: InteropEnvelope; readonly bytes: Buffer } {
  const bytes = originalBytes();
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const original = {
    state: 'available' as const,
    blobId: 'bookmark-original',
    mimeType: 'image/png',
    byteLength: bytes.length,
    contentHash,
  };
  const record = interopRecordSchema.parse({
    schemaVersion: 1,
    identity: {
      interopId: RECORD_ID,
      origin: { product: 'image-trail', localId: 'bookmark-runtime' },
      contentHash,
    },
    revision: { imageTrail: 1, overlook: 0 },
    fieldRevisions: {},
    recordKind: 'web-bookmark',
    title: 'Runtime original',
    label: null,
    sourceUrl: 'https://example.test/runtime',
    dimensions: { width: 10, height: 10 },
    timestamps: {
      bookmarkedAt: '2026-07-21T17:00:00.000Z',
      capturedAt: null,
      downloadedAt: null,
      takenAt: null,
      importedAt: null,
    },
    sourceCompatibility: 'image-trail-v1',
    original,
    thumbnail: {
      state: 'unavailable',
      blobId: null,
      mimeType: null,
      byteLength: null,
      contentHash: null,
      reason: 'not-captured',
    },
    albumIds: [],
    roundTripMetadata: { imageTrail: {}, overlook: {} },
    deletedAt: null,
  });
  return {
    bytes,
    record: interopEnvelopeSchema.parse({
      header: header(RECORD_MESSAGE_ID, 'record', 1),
      payload: { kind: 'record', schemaVersion: 1, record, albums: [], reviewCategory: 'eligible' },
    }),
    blob: interopEnvelopeSchema.parse({
      header: header(BLOB_MESSAGE_ID, 'blob', 2),
      payload: {
        kind: 'blob',
        schemaVersion: 1,
        recordInteropId: RECORD_ID,
        role: 'original',
        blob: original,
        encryptedPath: moveOriginalBlobPath(RECORD_ID),
        chunkIndex: 0,
        chunkCount: 1,
      },
    }),
  };
}

async function publish(store: MemoryStore): Promise<ReturnType<typeof sourceMessages>> {
  const source = sourceMessages();
  const transport = new EncryptedInteropTransport(store, 32);
  const scope = { pairingId: PAIRING_ID, transferId: TRANSFER_ID };
  await transport.upload(scope, moveOutboxMessagePath(1, RECORD_MESSAGE_ID), sealInteropMessage(source.record, CUSTODY));
  await transport.upload(scope, moveOutboxMessagePath(2, BLOB_MESSAGE_ID), sealInteropMessage(source.blob, CUSTODY));
  const record = source.record.payload.kind === 'record' ? source.record.payload.record : null;
  if (record === null || record.original.state !== 'available') throw new Error('Expected available original.');
  await transport.upload(
    scope,
    moveOriginalBlobPath(RECORD_ID),
    sealInteropBlob({ key: CUSTODY, transferId: TRANSFER_ID, recordInteropId: RECORD_ID, blob: record.original, bytes: source.bytes }),
  );
  return source;
}

test('explicit refresh previews, imports durably, and resumes ACK upload without repeating acceptance', async () => {
  const store = new MemoryStore();
  const source = await publish(store);
  const db = openLibraryDatabase({
    path: join(mkdtempSync(join(tmpdir(), 'overlook-inbound-runtime-')), 'library.db'),
    dbKey: randomBytes(32),
  });
  const journals = new MoveJournalRepository(db);
  const objects = new InboundMoveObjectJournal(db);
  let failAcknowledgementJournalOnce = true;
  let imports = 0;
  let marker = '';
  const runtime = new InboundMoveRuntime({
    store,
    custody: () => CUSTODY,
    translation: { previewRecord: () => 'eligible' },
    journals,
    objects: {
      discover: (input) => objects.discover(input),
      require: (transferId, path) => objects.require(transferId, path),
      advance: (transferId, path, phase, at, acknowledgementMessageId) => {
        if (phase === 'ack-journaled' && failAcknowledgementJournalOnce) {
          failAcknowledgementJournalOnce = false;
          throw new Error('injected acknowledgement journal boundary crash');
        }
        return objects.advance(transferId, path, phase, at, acknowledgementMessageId);
      },
    },
    createMessageId: () => ACK_MESSAGE_ID,
    now: () => '2026-07-21T18:00:00.000Z',
    importer: {
      acceptWithoutOriginal: () => {
        throw new Error('unexpected metadata-only import');
      },
      acceptOriginal: (_record, _albums, category, bytes, hooks) => {
        imports += 1;
        marker = bytes.toString('hex');
        hooks.blobCommitted();
        hooks.databaseCommitted();
        return Promise.resolve({
          accepted: true,
          reviewCategory: category,
          targetLocalId: 'native-runtime-photo',
          metadataPersisted: true,
          originalVerification: 'verified',
          photoChanged: true,
          reason: null,
        });
      },
    },
  });
  const preview = await runtime.refresh();
  assert.equal(preview[0]?.counts.eligible, 1);
  assert.equal(imports, 0, 'manual discovery has no import side effect');

  await assert.rejects(runtime.start(TRANSFER_ID), /injected acknowledgement journal boundary crash/u);
  assert.equal(imports, 1);
  assert.equal(marker, source.bytes.toString('hex'));
  assert.equal(journals.pendingOutbox(TRANSFER_ID).length, 1);

  store.failAcknowledgementOnce = true;
  await assert.rejects(runtime.start(TRANSFER_ID), /injected acknowledgement upload failure/u);
  assert.equal(imports, 1, 'durable receipt advances committed rows without repeating native import');

  const resumed = await runtime.start(TRANSFER_ID);
  assert.equal(resumed.accepted, 1);
  assert.equal(imports, 1, 'durable receipt prevents a repeated native import');
  assert.equal(journals.pendingOutbox(TRANSFER_ID).length, 0);
  const acknowledgementBytes = await new EncryptedInteropTransport(store).download(
    { pairingId: PAIRING_ID, transferId: TRANSFER_ID },
    moveAcknowledgementPath(1, ACK_MESSAGE_ID),
  );
  const acknowledgement = openInteropMessage(acknowledgementBytes, CUSTODY);
  assert.equal(acknowledgement.payload.kind, 'acknowledgement');
  if (acknowledgement.payload.kind !== 'acknowledgement') throw new Error('Expected acknowledgement.');
  assert.deepEqual(acknowledgement.payload.acknowledgedMessageIds, [RECORD_MESSAGE_ID, BLOB_MESSAGE_ID]);
  assert.equal(objects.require(TRANSFER_ID, moveOutboxMessagePath(1, RECORD_MESSAGE_ID)).phase, 'ack-uploaded');
  assert.equal(objects.require(TRANSFER_ID, moveOutboxMessagePath(2, BLOB_MESSAGE_ID)).phase, 'ack-uploaded');
  db.close();
});
