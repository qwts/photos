import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { openLibraryDatabase } from '../../src/main/db/database.js';
import { InboundMoveDiscovery, parseInboundMoveManifestPath } from '../../src/main/interop/inbound-move-discovery.js';
import { MoveJournalRepository } from '../../src/main/interop/move-journal-repository.js';
import type { InteropObjectPage, InteropObjectStore } from '../../src/main/interop/transport.js';
import { interopEnvelopeSchema } from '../../src/shared/interop/messages.js';

const PAIRING_ID = '56d15daa-4f24-466c-b20d-69b78e8320f6';
const TRANSFER_ID = '48ced8d7-2f3a-4b60-967f-8f1c27867e65';
const RECORD_ID = 'bf1842f7-56b2-4d84-a7b1-b3bedcddf97b';
const MESSAGE_1 = '6af6239d-8ce9-4ac8-b9ca-ffb0e55635cf';
const MESSAGE_2 = 'c8865ad8-8975-4abe-9a1c-bbde10a71efa';

function manifest(logicalPath: string): string {
  return `pairings/${PAIRING_ID}/transfers/${TRANSFER_ID}/objects/${logicalPath}.manifest.json`;
}

class PagedStore implements InteropObjectStore {
  readonly provider = 'pcloud' as const;

  constructor(private readonly pages: Readonly<Record<string, InteropObjectPage>>) {}

  authState(): Promise<'connected'> {
    return Promise.resolve('connected');
  }

  list(_prefix: string, cursor: string | null): Promise<InteropObjectPage> {
    const page = this.pages[cursor ?? 'first'];
    if (page === undefined) throw new Error('unexpected cursor');
    return Promise.resolve(page);
  }

  put(): Promise<{ readonly bytes: number }> {
    throw new Error('not used');
  }

  get(): Promise<Buffer> {
    throw new Error('not used');
  }

  delete(): Promise<void> {
    throw new Error('not used');
  }

  quota(): Promise<{ readonly usedBytes: number; readonly totalBytes: number | null }> {
    throw new Error('not used');
  }

  verify(): Promise<{ readonly sha256: string; readonly bytes: number }> {
    throw new Error('not used');
  }
}

test('paginates canonical manifests and ignores chunk objects', async () => {
  const firstPath = manifest(`messages/outbox/000000000001-${MESSAGE_1}.json.aesgcm`);
  const secondPath = manifest(`messages/outbox/000000000002-${MESSAGE_2}.json.aesgcm`);
  const blobPath = manifest(`blobs/${RECORD_ID}/original.bin.aesgcm`);
  const store = new PagedStore({
    first: {
      entries: [
        { path: firstPath, bytes: 10 },
        { path: `${firstPath}.chunks/00000000.bin`, bytes: 10 },
      ],
      nextCursor: '2',
    },
    '2': {
      entries: [
        { path: secondPath, bytes: 10 },
        { path: blobPath, bytes: 10 },
      ],
      nextCursor: null,
    },
  });
  const transfers = await new InboundMoveDiscovery(store).discover(PAIRING_ID);
  assert.equal(transfers.length, 1);
  assert.deepEqual(
    transfers[0]?.messages.map(({ sequence, messageId }) => ({ sequence, messageId })),
    [
      { sequence: 1, messageId: MESSAGE_1 },
      { sequence: 2, messageId: MESSAGE_2 },
    ],
  );
  assert.equal(transfers[0]?.originals[0]?.recordInteropId, RECORD_ID);
});

test('rejects missing sequences, collisions, unsupported manifests, and replayed cursors', async () => {
  const entry = (sequence: number, messageId: string) => ({
    path: manifest(`messages/outbox/${String(sequence).padStart(12, '0')}-${messageId}.json.aesgcm`),
    bytes: 10,
  });
  await assert.rejects(
    new InboundMoveDiscovery(new PagedStore({ first: { entries: [entry(2, MESSAGE_1)], nextCursor: null } })).discover(PAIRING_ID),
    /sequence is incomplete/u,
  );
  await assert.rejects(
    new InboundMoveDiscovery(new PagedStore({ first: { entries: [entry(1, MESSAGE_1), entry(1, MESSAGE_2)], nextCursor: null } })).discover(
      PAIRING_ID,
    ),
    /reuses a message sequence/u,
  );
  await assert.rejects(
    new InboundMoveDiscovery(
      new PagedStore({ first: { entries: [{ path: manifest('messages/unknown.json.aesgcm'), bytes: 10 }], nextCursor: null } }),
    ).discover(PAIRING_ID),
    /unsupported canonical path/u,
  );
  await assert.rejects(
    new InboundMoveDiscovery(
      new PagedStore({ first: { entries: [], nextCursor: 'same' }, same: { entries: [], nextCursor: 'same' } }),
    ).discover(PAIRING_ID),
    /cursor was replayed/u,
  );
  assert.equal(parseInboundMoveManifestPath(PAIRING_ID, 'unrelated/chunk.bin'), null);
});

test('record discovery is durable and rejects replay identity changes before acceptance', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'overlook-move-discovery-')), 'library.db');
  const db = openLibraryDatabase({ path, dbKey: randomBytes(32) });
  const fixture = interopEnvelopeSchema.parse(
    JSON.parse(readFileSync('design/handoff/contracts/v1/fixtures/valid-record-message.json', 'utf8')) as unknown,
  );
  assert.equal(fixture.payload.kind, 'record');
  if (fixture.payload.kind !== 'record') throw new Error('Expected a record fixture.');
  const recordPayload = fixture.payload;
  const journals = new MoveJournalRepository(db);
  const first = journals.recordDiscovery(fixture, 'duplicate', '2026-07-21T18:00:00.000Z');
  assert.equal(first.phase, 'reviewing');
  assert.equal(journals.items(fixture.header.transferId)[0]?.reviewCategory, 'duplicate');
  assert.equal(journals.items(fixture.header.transferId).length, 1);
  assert.equal(journals.recordDiscovery(fixture, 'duplicate', '2026-07-21T18:00:01.000Z').counts.total, 1);
  assert.throws(
    () =>
      journals.recordDiscovery(
        interopEnvelopeSchema.parse({
          ...fixture,
          payload: { ...recordPayload, record: { ...recordPayload.record, title: 'replayed content' } },
        }),
        'duplicate',
        '2026-07-21T18:00:02.000Z',
      ),
    /identity was replayed/u,
  );
  db.close();
});
