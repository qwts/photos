import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createInteropPairingBundle } from '../../../src/main/interop/pairing.js';
import { FilesystemInteropObjectStore } from '../../../src/main/interop/filesystem-object-store.js';
import { openInteropMessage, sealInteropBlob, sealInteropMessage } from '../../../src/main/interop/sealed-transport.js';
import { EncryptedInteropTransport } from '../../../src/main/interop/transport.js';
import type { InteropKeyCustody } from '../../../src/main/interop/pairing-custody.js';
import { INTEROP_CONTRACT_VERSION, INTEROP_MAGIC } from '../../../src/shared/interop/contract.js';
import { interopEnvelopeSchema } from '../../../src/shared/interop/messages.js';
import { interopRecordSchema } from '../../../src/shared/interop/records.js';
import { moveOriginalBlobPath, moveOutboxMessagePath } from '../../../src/shared/interop/sealed-transport-contract.js';

const PAIRING_ID = '56d15daa-4f24-466c-b20d-69b78e8320f6';
const TRANSFER_ID = '48ced8d7-2f3a-4b60-967f-8f1c27867e65';
const RECORD_ID = 'bf1842f7-56b2-4d84-a7b1-b3bedcddf97b';
const RECORD_MESSAGE_ID = '6af6239d-8ce9-4ac8-b9ca-ffb0e55635cf';
const BLOB_MESSAGE_ID = 'c8865ad8-8975-4abe-9a1c-bbde10a71efa';
const KEY_ID = `interop:${PAIRING_ID}`;
const PASSWORD = 'e2e pairing password';
const INTEROP_KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

const custody: InteropKeyCustody = { pairingId: PAIRING_ID, keyId: KEY_ID, interopKey: INTEROP_KEY };

export interface InboundMoveFixture {
  readonly pairingBundle: string;
  readonly providerRoot: string;
  readonly password: string;
  readonly photoId: string;
  acknowledgement(): Promise<ReturnType<typeof openInteropMessage>>;
  acknowledgementCount(): Promise<number>;
}

export async function createInboundMoveFixture(root: string): Promise<InboundMoveFixture> {
  const providerRoot = join(root, 'pcloud');
  mkdirSync(providerRoot, { recursive: true });
  const pairingBundle = join(root, 'pairing-bundle.json');
  const bundle = await createInteropPairingBundle(PASSWORD, {
    pairingId: PAIRING_ID,
    keyId: KEY_ID,
    interopKey: INTEROP_KEY,
    now: '2026-07-21T18:00:00.000Z',
  });
  writeFileSync(pairingBundle, `${JSON.stringify(bundle)}\n`, { mode: 0o600 });

  const bytes = readFileSync(join(import.meta.dirname, '../../fixtures/exif/exif-stripped.jpg'));
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const original = {
    state: 'available' as const,
    blobId: 'bookmark-original',
    mimeType: 'image/jpeg',
    byteLength: bytes.length,
    contentHash,
  };
  const record = interopRecordSchema.parse({
    schemaVersion: 1,
    identity: { interopId: RECORD_ID, origin: { product: 'image-trail', localId: 'bookmark-e2e' }, contentHash },
    revision: { imageTrail: 1, overlook: 0 },
    fieldRevisions: {},
    recordKind: 'web-bookmark',
    title: 'Trail Summit',
    label: null,
    sourceUrl: 'https://example.test/trail-summit',
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
  const recordEnvelope = interopEnvelopeSchema.parse({
    header: header(RECORD_MESSAGE_ID, 'record', 1),
    payload: { kind: 'record', schemaVersion: 1, record, albums: [], reviewCategory: 'eligible' },
  });
  const blobEnvelope = interopEnvelopeSchema.parse({
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
  });
  const store = new FilesystemInteropObjectStore(providerRoot);
  const transport = new EncryptedInteropTransport(store);
  const scope = { pairingId: PAIRING_ID, transferId: TRANSFER_ID };
  await transport.upload(scope, moveOutboxMessagePath(1, RECORD_MESSAGE_ID), sealInteropMessage(recordEnvelope, custody));
  await transport.upload(scope, moveOutboxMessagePath(2, BLOB_MESSAGE_ID), sealInteropMessage(blobEnvelope, custody));
  await transport.upload(
    scope,
    moveOriginalBlobPath(RECORD_ID),
    sealInteropBlob({ key: custody, transferId: TRANSFER_ID, recordInteropId: RECORD_ID, blob: original, bytes }),
  );

  return {
    pairingBundle,
    providerRoot,
    password: PASSWORD,
    photoId: `interop-${RECORD_ID}`,
    acknowledgementCount: async () => {
      const page = await store.list(`pairings/${PAIRING_ID}/transfers/${TRANSFER_ID}/objects/messages/acknowledgements`, null);
      return page.entries.filter((entry) => entry.path.endsWith('.manifest.json')).length;
    },
    acknowledgement: async () => {
      const prefix = `pairings/${PAIRING_ID}/transfers/${TRANSFER_ID}/objects/messages/acknowledgements`;
      const page = await store.list(prefix, null);
      const manifest = page.entries.find((entry) => entry.path.endsWith('.manifest.json'));
      if (manifest === undefined) throw new Error('Inbound Move acknowledgement was not uploaded.');
      const marker = '/objects/';
      const offset = manifest.path.indexOf(marker);
      const path = manifest.path.slice(offset + marker.length, -'.manifest.json'.length);
      return openInteropMessage(await transport.download(scope, path), custody);
    },
  };
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
