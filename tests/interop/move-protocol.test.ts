import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { openLibraryDatabase } from '../../src/main/db/database.js';
import { PhotosRepository } from '../../src/main/db/photos-repository.js';
import { InteropRepository } from '../../src/main/interop/interop-repository.js';
import { MoveJournalRepository } from '../../src/main/interop/move-journal-repository.js';
import { MoveProtocolError, MoveProtocolService, type MoveSourceOriginalAction } from '../../src/main/interop/move-protocol.js';
import { InteropTranslationService } from '../../src/main/interop/translation-service.js';
import type { InteropProduct } from '../../src/shared/interop/contract.js';
import { interopEnvelopeSchema, type InteropEnvelope } from '../../src/shared/interop/messages.js';

const SOURCE_KEY = randomBytes(32);
const TARGET_KEY = randomBytes(32);
const FIRST_ACK_ID = '37813aa3-a4f4-4d23-8f35-43f64127388a';
const RETRY_ACK_ID = '0e3d566f-626d-4a94-9cb1-c20c11db0e76';
const STALE_ACK_ID = '72612e33-901d-40f6-b2f5-e9c4592343a6';
const SOURCE_BLOB_MESSAGE_ID = 'de544b78-c183-4f3a-8665-7c5897aabf30';

function databasePath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), `overlook-move-${name}-`)), 'library.db');
}

function fixture(name: 'valid-record-message' | 'round-trip-record-message'): InteropEnvelope {
  const value = JSON.parse(readFileSync(`design/handoff/contracts/v1/fixtures/${name}.json`, 'utf8')) as unknown;
  return interopEnvelopeSchema.parse(value);
}

function availableMoveRequest(): InteropEnvelope {
  const envelope = fixture('round-trip-record-message');
  return interopEnvelopeSchema.parse({
    ...envelope,
    header: { ...envelope.header, operation: 'move' },
  });
}

function clock(): () => string {
  let tick = 0;
  return () => {
    tick += 1;
    return `2026-07-16T16:00:${String(tick).padStart(2, '0')}.000Z`;
  };
}

function ids(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) throw new Error('test exhausted deterministic message ids');
    return value;
  };
}

function openProtocol(input: {
  readonly path: string;
  readonly key: Buffer;
  readonly localProduct: InteropProduct;
  readonly now: () => string;
  readonly createMessageId?: (() => string) | undefined;
}) {
  const db = openLibraryDatabase({ path: input.path, dbKey: input.key });
  const journals = new MoveJournalRepository(db);
  const interop = new InteropRepository(db);
  const translation = new InteropTranslationService(interop, new PhotosRepository(db));
  const service = new MoveProtocolService(input.localProduct, journals, translation, {
    now: input.now,
    createMessageId: input.createMessageId,
  });
  return { db, journals, service };
}

describe('MoveProtocolService', () => {
  test('resumes metadata-only Move across every durable boundary without claiming or deleting an original', async () => {
    const request = fixture('valid-record-message');
    const sourcePath = databasePath('metadata-source');
    const targetPath = databasePath('metadata-target');
    const now = clock();

    let source = openProtocol({ path: sourcePath, key: SOURCE_KEY, localProduct: 'image-trail', now });
    const queued = source.service.queue(request);
    assert.equal(queued.phase, 'awaiting-acknowledgement');
    assert.deepEqual(queued.counts, {
      total: 1,
      eligible: 0,
      duplicate: 0,
      conflict: 0,
      metadataOnly: 1,
      unsupported: 0,
      skipped: 0,
      failed: 0,
      acknowledged: 0,
      finalized: 0,
    });
    assert.deepEqual(source.service.queue(request).counts, queued.counts, 'queue replay did not inflate counts');
    source.db.close();

    source = openProtocol({ path: sourcePath, key: SOURCE_KEY, localProduct: 'image-trail', now });
    assert.equal(source.journals.pendingOutbox(request.header.transferId).length, 1, 'outbox survived restart');

    let verifierCalls = 0;
    let target = openProtocol({
      path: targetPath,
      key: TARGET_KEY,
      localProduct: 'overlook',
      now,
      createMessageId: ids(FIRST_ACK_ID),
    });
    const acknowledgement = await target.service.receive(request, {
      verify: () => {
        verifierCalls += 1;
        return Promise.resolve({ verified: true, targetLocalId: null });
      },
    });
    assert.equal(verifierCalls, 0, 'metadata-only records never run original verification');
    assert.equal(acknowledgement.payload.kind, 'acknowledgement');
    if (acknowledgement.payload.kind !== 'acknowledgement') return assert.fail('acknowledgement expected');
    assert.equal(acknowledgement.payload.status, 'accepted');
    assert.equal(acknowledgement.payload.originalVerification, 'metadata-only');
    target.db.close();

    target = openProtocol({
      path: targetPath,
      key: TARGET_KEY,
      localProduct: 'overlook',
      now,
      createMessageId: ids(RETRY_ACK_ID),
    });
    assert.deepEqual(
      await target.service.receive(request, { verify: () => assert.fail('accepted replay must not verify again') }),
      acknowledgement,
    );
    await assert.rejects(
      target.service.receive(
        interopEnvelopeSchema.parse({
          ...request,
          header: { ...request.header, transferId: '59999999-9999-4999-8999-999999999999' },
        }),
        { verify: () => assert.fail('cross-transfer replay must fail first') },
      ),
      /replay identity was reused/u,
    );
    assert.equal(target.journals.getJournal(request.header.transferId)?.counts.acknowledged, 1);
    target.db.close();

    const acknowledged = source.service.acknowledge(acknowledgement);
    assert.equal(acknowledged.counts.acknowledged, 1);
    assert.equal(source.service.acknowledge(acknowledgement).counts.acknowledged, 1, 'ack replay did not inflate counts');

    let finalizerCalls = 0;
    let action: MoveSourceOriginalAction | null = null;
    const interrupted = await source.service.resumeFinalization(request.header.transferId, {
      finalize: (input) => {
        finalizerCalls += 1;
        action = input.originalAction;
        throw new Error('fault after source finalizer started');
      },
    });
    assert.equal(interrupted.failed, 1);
    assert.equal(interrupted.journal.phase, 'failed');
    assert.equal(action, 'preserve-original');
    source.db.close();

    source = openProtocol({ path: sourcePath, key: SOURCE_KEY, localProduct: 'image-trail', now });
    const resumed = await source.service.resumeFinalization(request.header.transferId, {
      finalize: (input) => {
        finalizerCalls += 1;
        assert.equal(input.originalAction, 'preserve-original');
        return Promise.resolve();
      },
    });
    assert.equal(resumed.finalized, 1);
    assert.equal(resumed.journal.phase, 'completed');
    assert.equal(resumed.journal.counts.acknowledged, 1);
    assert.equal(resumed.journal.counts.finalized, 1);
    assert.equal(resumed.journal.counts.failed, 0);
    assert.equal(finalizerCalls, 2, 'idempotent finalizer was retried after restart');
    assert.equal(
      (await source.service.resumeFinalization(request.header.transferId, { finalize: () => assert.fail('already final') })).finalized,
      0,
    );
    assert.equal(source.service.queue(request).phase, 'completed', 'late queue replay did not regress the completed journal');
    assert.deepEqual(
      source.journals.audit(request.header.transferId).map((event) => event.event),
      ['queued', 'acknowledged', 'finalizing', 'failed', 'finalized'],
    );
    source.db.close();
  });

  test('keeps an available source intact until a retry proves target byte custody', async () => {
    const request = availableMoveRequest();
    const sourcePath = databasePath('original-source');
    const targetPath = databasePath('original-target');
    const now = clock();
    const source = openProtocol({ path: sourcePath, key: SOURCE_KEY, localProduct: 'overlook', now });
    source.service.queue(request);

    const target = openProtocol({
      path: targetPath,
      key: TARGET_KEY,
      localProduct: 'image-trail',
      now,
      createMessageId: ids(FIRST_ACK_ID, RETRY_ACK_ID),
    });
    const rejected = await target.service.receive(request, {
      verify: () => Promise.resolve({ verified: false, targetLocalId: 'target-photo' }),
    });
    assert.equal(rejected.payload.kind, 'acknowledgement');
    if (rejected.payload.kind !== 'acknowledgement') return assert.fail('acknowledgement expected');
    assert.equal(rejected.payload.status, 'rejected');
    const rejectedJournal = source.service.acknowledge(rejected);
    assert.equal(rejectedJournal.phase, 'failed');
    assert.equal(rejectedJournal.counts.failed, 1);
    assert.equal(rejectedJournal.counts.acknowledged, 0);

    let sourceRemoved = false;
    const beforeVerification = await source.service.resumeFinalization(request.header.transferId, {
      finalize: () => {
        sourceRemoved = true;
        return Promise.resolve();
      },
    });
    assert.equal(beforeVerification.finalized, 0);
    assert.equal(sourceRemoved, false);

    const accepted = await target.service.receive(request, {
      verify: () =>
        Promise.resolve({
          verified: true,
          targetLocalId: 'target-photo',
          sourceMessageIds: [SOURCE_BLOB_MESSAGE_ID],
        }),
    });
    assert.equal(accepted.payload.kind, 'acknowledgement');
    if (accepted.payload.kind !== 'acknowledgement') return assert.fail('acknowledgement expected');
    assert.equal(accepted.payload.status, 'accepted');
    assert.equal(accepted.payload.originalVerification, 'verified');
    assert.deepEqual(accepted.payload.acknowledgedMessageIds, [request.header.messageId, SOURCE_BLOB_MESSAGE_ID]);
    assert.notEqual(accepted.header.messageId, rejected.header.messageId, 'retry emitted a fresh acknowledgement');
    source.service.acknowledge(accepted);

    const staleRejection = interopEnvelopeSchema.parse({
      ...rejected,
      header: { ...rejected.header, messageId: STALE_ACK_ID },
    });
    const afterStaleRejection = source.service.acknowledge(staleRejection);
    assert.equal(afterStaleRejection.phase, 'acknowledged');
    assert.equal(afterStaleRejection.counts.acknowledged, 1);
    assert.equal(afterStaleRejection.counts.failed, 0);

    const completed = await source.service.resumeFinalization(request.header.transferId, {
      finalize: (input) => {
        assert.equal(input.originalAction, 'remove-after-verified-copy');
        assert.equal(input.targetLocalId, 'target-photo');
        sourceRemoved = true;
        return Promise.resolve();
      },
    });
    assert.equal(sourceRemoved, true);
    assert.equal(completed.journal.phase, 'completed');
    assert.equal(completed.journal.counts.eligible, 1);
    assert.equal(completed.journal.counts.acknowledged, 1);
    assert.equal(completed.journal.counts.finalized, 1);
    assert.equal(completed.journal.counts.failed, 0);
    assert.equal(target.journals.pendingOutbox(request.header.transferId).length, 1, 'failed acknowledgement was superseded');
    target.db.close();
    source.db.close();
  });

  test('derives exact review counts from durable items instead of replay increments', async () => {
    const base = fixture('valid-record-message');
    assert.equal(base.payload.kind, 'record');
    if (base.payload.kind !== 'record') return assert.fail('record expected');
    const recordPayload = base.payload;
    const path = databasePath('exact-counts');
    const now = clock();
    let source = openProtocol({ path, key: SOURCE_KEY, localProduct: 'image-trail', now });
    const categories = ['eligible', 'duplicate', 'skipped'] as const;
    const recordIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ] as const;
    const messageIds = [
      '41111111-1111-4111-8111-111111111111',
      '42222222-2222-4222-8222-222222222222',
      '43333333-3333-4333-8333-333333333333',
    ] as const;
    const requests = categories.map((reviewCategory, index) =>
      interopEnvelopeSchema.parse({
        ...base,
        header: { ...base.header, messageId: messageIds[index], sequence: index + 1 },
        payload: {
          ...recordPayload,
          reviewCategory,
          record: {
            ...recordPayload.record,
            identity: {
              ...recordPayload.record.identity,
              interopId: recordIds[index],
              origin: { ...recordPayload.record.identity.origin, localId: `bookmark-${String(index)}` },
            },
          },
        },
      }),
    );
    for (const request of requests) source.service.queue(request);
    const expected = {
      total: 3,
      eligible: 1,
      duplicate: 1,
      conflict: 0,
      metadataOnly: 0,
      unsupported: 0,
      skipped: 1,
      failed: 0,
      acknowledged: 0,
      finalized: 0,
    };
    assert.deepEqual(source.journals.getJournal(base.header.transferId)?.counts, expected);
    for (const request of requests) source.service.queue(request);
    source.db.close();

    source = openProtocol({ path, key: SOURCE_KEY, localProduct: 'image-trail', now });
    assert.deepEqual(source.journals.getJournal(base.header.transferId)?.counts, expected);
    assert.equal(source.journals.pendingOutbox(base.header.transferId).length, 3);
    const first = requests[0];
    assert.ok(first);
    assert.equal(first.payload.kind, 'record');
    if (first.payload.kind !== 'record') return assert.fail('record expected');
    const acknowledgement = interopEnvelopeSchema.parse({
      header: {
        ...first.header,
        messageId: FIRST_ACK_ID,
        sourceProduct: first.header.targetProduct,
        targetProduct: first.header.sourceProduct,
        kind: 'acknowledgement',
      },
      payload: {
        kind: 'acknowledgement',
        schemaVersion: 1,
        status: 'accepted',
        recordInteropId: first.payload.record.identity.interopId,
        targetLocalId: null,
        metadataPersisted: true,
        originalVerification: 'metadata-only',
        acknowledgedMessageIds: [first.header.messageId],
        errors: [],
      },
    });
    assert.equal(source.service.acknowledge(acknowledgement).phase, 'awaiting-acknowledgement');
    const partial = await source.service.resumeFinalization(base.header.transferId, { finalize: () => Promise.resolve() });
    assert.equal(partial.journal.phase, 'awaiting-acknowledgement');
    assert.equal(partial.journal.counts.finalized, 1);
    assert.equal(partial.journal.counts.acknowledged, 1);
    source.db.close();
  });

  test('rejects a forged accepted acknowledgement that does not prove original custody', () => {
    const request = availableMoveRequest();
    const path = databasePath('forged-source');
    const now = clock();
    const source = openProtocol({ path, key: SOURCE_KEY, localProduct: 'overlook', now });
    source.service.queue(request);
    assert.equal(request.payload.kind, 'record');
    if (request.payload.kind !== 'record') return assert.fail('record expected');
    const forged = interopEnvelopeSchema.parse({
      header: {
        ...request.header,
        messageId: FIRST_ACK_ID,
        sourceProduct: 'image-trail',
        targetProduct: 'overlook',
        kind: 'acknowledgement',
      },
      payload: {
        kind: 'acknowledgement',
        schemaVersion: 1,
        status: 'accepted',
        recordInteropId: request.payload.record.identity.interopId,
        targetLocalId: 'target-photo',
        metadataPersisted: true,
        originalVerification: 'unavailable',
        acknowledgedMessageIds: [request.header.messageId],
        errors: [],
      },
    });
    assert.throws(() => source.service.acknowledge(forged), MoveProtocolError);
    assert.equal(source.journals.getJournal(request.header.transferId)?.counts.acknowledged, 0);
    source.db.close();
  });
});
