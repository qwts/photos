import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { openLibraryDatabase } from '../../src/main/db/database.js';
import { SyncProtocolService } from '../../src/main/interop/sync-protocol.js';
import { SyncRepository } from '../../src/main/interop/sync-repository.js';
import { interopEnvelopeSchema, type InteropEnvelope } from '../../src/shared/interop/messages.js';
import type { InteropRecord } from '../../src/shared/interop/records.js';

const DB_KEY = randomBytes(32);
const SESSION_ID = '0f55fc4f-e49f-49cf-b9d7-cf849b0f7daf';
const SECOND_SESSION_ID = '3dbf3151-2061-47ef-b91e-3b7bcbad167c';
const SECOND_MESSAGE_ID = '56d3d0a4-b271-4037-80cf-ec98a436910f';
const THIRD_SESSION_ID = '52ac49fd-df53-4a0e-807f-ea95e415c75c';
const THIRD_MESSAGE_ID = '26b2eaf7-d7da-48f7-87f8-b809b90b1e64';

type RecordEnvelope = InteropEnvelope & { payload: { kind: 'record'; record: InteropRecord } };

function databasePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'overlook-sync-')), 'library.db');
}

function fixture(): RecordEnvelope {
  const input = JSON.parse(readFileSync('design/handoff/contracts/v1/fixtures/round-trip-record-message.json', 'utf8')) as unknown;
  const envelope = interopEnvelopeSchema.parse(input);
  assert.equal(envelope.payload.kind, 'record');
  return envelope as RecordEnvelope;
}

function syncEnvelope(
  input: {
    readonly sessionId?: string;
    readonly messageId?: string;
    readonly record?: InteropRecord;
  } = {},
): RecordEnvelope {
  const envelope = fixture();
  return interopEnvelopeSchema.parse({
    ...envelope,
    header: {
      ...envelope.header,
      operation: 'sync',
      transferId: input.sessionId ?? SESSION_ID,
      messageId: input.messageId ?? envelope.header.messageId,
      sourceProduct: 'image-trail',
      targetProduct: 'overlook',
    },
    payload: { ...envelope.payload, record: input.record ?? envelope.payload.record },
  }) as RecordEnvelope;
}

function clock(): () => string {
  let tick = 0;
  return () => {
    tick += 1;
    return `2026-07-16T18:20:${String(tick).padStart(2, '0')}.000Z`;
  };
}

function open(path: string, now: () => string) {
  const db = openLibraryDatabase({ path, dbKey: DB_KEY });
  const repository = new SyncRepository(db);
  const service = new SyncProtocolService('overlook', repository, { now });
  return { db, repository, service };
}

function start(service: SyncProtocolService, envelope: InteropEnvelope, sessionId = SESSION_ID) {
  return service.start({
    sessionId,
    pairingId: envelope.header.pairingId,
    sourceProduct: envelope.header.sourceProduct,
    targetProduct: envelope.header.targetProduct,
    direction: 'two-way',
    scope: { kind: 'all', localIds: [] },
  });
}

describe('SyncProtocolService', () => {
  test('persists replay-safe per-field decisions and resumes apply after restart', async () => {
    const path = databasePath();
    const now = clock();
    const envelope = syncEnvelope();
    const remote = fixture().payload.record;
    const local = {
      ...remote,
      title: 'Overlook title',
      revision: { imageTrail: 1, overlook: 3 },
      fieldRevisions: { ...remote.fieldRevisions, title: { imageTrail: 1, overlook: 3 } },
    };
    const incoming = interopEnvelopeSchema.parse({
      ...envelope,
      payload: {
        ...envelope.payload,
        record: {
          ...remote,
          title: 'Image Trail title',
          revision: { imageTrail: 3, overlook: 1 },
          fieldRevisions: { ...remote.fieldRevisions, title: { imageTrail: 3, overlook: 1 } },
        },
      },
    }) as RecordEnvelope;

    let opened = open(path, now);
    start(opened.service, incoming);
    const reviewed = opened.service.receive(SESSION_ID, incoming, local);
    assert.equal(reviewed.state, 'conflict');
    assert.deepEqual(
      reviewed.analysis.conflicts.map(({ field }) => field),
      ['title'],
    );
    assert.equal(opened.service.receive(SESSION_ID, incoming, local).state, 'conflict');
    assert.equal(opened.repository.counts(SESSION_ID).total, 1, 'receipt replay did not inflate progress');
    assert.throws(
      () =>
        opened.service.receive(
          SESSION_ID,
          interopEnvelopeSchema.parse({
            ...incoming,
            payload: { ...incoming.payload, record: { ...incoming.payload.record, label: 'changed replay' } },
          }),
          local,
        ),
      /replayed with different content/u,
    );
    opened.service.pause(SESSION_ID);
    opened.db.close();

    opened = open(path, now);
    assert.equal(opened.repository.getSession(SESSION_ID)?.phase, 'paused');
    assert.throws(() => opened.service.decide(SESSION_ID, remote.identity.interopId, 'title', 'keep-overlook'), /paused/u);
    opened.service.resume(SESSION_ID);
    const ready = opened.service.decide(SESSION_ID, remote.identity.interopId, 'title', 'keep-overlook', true);
    assert.equal(ready.state, 'ready');

    let applyCalls = 0;
    const applied = await opened.service.apply(SESSION_ID, remote.identity.interopId, {
      apply: (request) => {
        applyCalls += 1;
        assert.equal(request.primary.title, 'Overlook title');
        assert.equal(request.secondary, null);
        assert.equal(request.deleteApproved, false);
        return Promise.resolve();
      },
    });
    assert.equal(applied.state, 'applied');
    assert.equal(opened.repository.counts(SESSION_ID).applied, 1);
    assert.equal(opened.repository.changesAfter(SESSION_ID, 'image-trail', 2).length, 1);
    assert.equal(opened.repository.advanceCheckpoint(SESSION_ID, 'image-trail', 3, now()).checkpoints['image-trail'], 3);
    opened.db.close();

    opened = open(path, now);
    await opened.service.apply(SESSION_ID, remote.identity.interopId, { apply: () => assert.fail('applied replay must be a no-op') });
    assert.equal(applyCalls, 1);
    assert.ok(opened.repository.audit(SESSION_ID).some((event) => event.event === 'decision'));
    opened.db.close();
  });

  test('requires tombstone review and disconnects without deleting either library', async () => {
    const path = databasePath();
    const now = clock();
    const base = fixture().payload.record;
    const tombstone = {
      ...base,
      deletedAt: '2026-07-16T18:20:00.000Z',
      revision: { imageTrail: base.revision.imageTrail + 1, overlook: base.revision.overlook },
      fieldRevisions: {
        ...base.fieldRevisions,
        deleted: { imageTrail: base.revision.imageTrail + 1, overlook: base.revision.overlook },
      },
    };
    const envelope = syncEnvelope({ sessionId: SECOND_SESSION_ID, messageId: SECOND_MESSAGE_ID, record: tombstone });
    const opened = open(path, now);
    start(opened.service, envelope, SECOND_SESSION_ID);
    const reviewed = opened.service.receive(SECOND_SESSION_ID, envelope, base);
    assert.equal(reviewed.state, 'delete-review');
    await assert.rejects(
      opened.service.apply(SECOND_SESSION_ID, base.identity.interopId, { apply: () => assert.fail('unreviewed delete applied') }),
      /requires conflict or delete review/u,
    );
    assert.equal(opened.service.reviewDelete(SECOND_SESSION_ID, base.identity.interopId, 'keep').state, 'skipped');
    let applyCalls = 0;
    await opened.service.apply(SECOND_SESSION_ID, base.identity.interopId, {
      apply: () => {
        applyCalls += 1;
        return Promise.resolve();
      },
    });
    assert.equal(applyCalls, 0);
    assert.equal(opened.service.disconnect(SECOND_SESSION_ID).connected, false);

    const later = syncEnvelope({
      sessionId: SECOND_SESSION_ID,
      messageId: 'd86337b1-3e69-4c96-985e-e78a56db5564',
      record: { ...base, label: 'later' },
    });
    assert.throws(() => opened.service.receive(SECOND_SESSION_ID, later, base), /disconnected or cancelled/u);
    assert.equal(opened.repository.counts(SECOND_SESSION_ID).skipped, 1);
    opened.db.close();
  });

  test('keeps a concurrent tombstone blocked after conflict fields are decided', async () => {
    const path = databasePath();
    const now = clock();
    const base = fixture().payload.record;
    const local: InteropRecord = {
      ...base,
      title: 'Overlook title',
      revision: { imageTrail: 1, overlook: 3 },
      fieldRevisions: { ...base.fieldRevisions, title: { imageTrail: 1, overlook: 3 } },
    };
    const remote: InteropRecord = {
      ...base,
      title: 'Image Trail title',
      deletedAt: '2026-07-16T18:20:00.000Z',
      revision: { imageTrail: 3, overlook: 1 },
      fieldRevisions: {
        ...base.fieldRevisions,
        title: { imageTrail: 3, overlook: 1 },
        deleted: { imageTrail: 3, overlook: 1 },
      },
    };
    const envelope = syncEnvelope({ sessionId: THIRD_SESSION_ID, messageId: THIRD_MESSAGE_ID, record: remote });
    const opened = open(path, now);
    start(opened.service, envelope, THIRD_SESSION_ID);
    assert.equal(opened.service.receive(THIRD_SESSION_ID, envelope, local).state, 'conflict');
    assert.equal(
      opened.service.decide(THIRD_SESSION_ID, base.identity.interopId, 'title', 'keep-image-trail', true).state,
      'delete-review',
    );
    await assert.rejects(
      opened.service.apply(THIRD_SESSION_ID, base.identity.interopId, { apply: () => Promise.resolve() }),
      /requires conflict or delete review/u,
    );
    assert.equal(opened.service.reviewDelete(THIRD_SESSION_ID, base.identity.interopId, 'apply').state, 'ready');
    assert.equal(opened.service.cancel(THIRD_SESSION_ID).phase, 'cancelled');
    assert.throws(() => opened.service.resume(THIRD_SESSION_ID), /cannot resume/u);
    opened.db.close();
  });

  test('rejects unreviewed direction, scope, and cross-session messages', () => {
    const opened = open(databasePath(), clock());
    assert.throws(
      () =>
        opened.service.start({
          sessionId: THIRD_SESSION_ID,
          pairingId: fixture().header.pairingId,
          sourceProduct: 'overlook',
          targetProduct: 'image-trail',
          direction: 'image-trail-to-overlook',
          scope: { kind: 'all', localIds: [] },
        }),
      /direction does not match/u,
    );
    assert.throws(
      () =>
        opened.service.start({
          sessionId: THIRD_SESSION_ID,
          pairingId: fixture().header.pairingId,
          sourceProduct: 'overlook',
          targetProduct: 'image-trail',
          direction: 'overlook-to-image-trail',
          scope: { kind: 'selected', localIds: [] },
        }),
      /scope ids/u,
    );
    const envelope = syncEnvelope({ sessionId: SECOND_SESSION_ID, messageId: THIRD_MESSAGE_ID });
    start(opened.service, envelope, THIRD_SESSION_ID);
    assert.throws(() => opened.service.receive(THIRD_SESSION_ID, envelope, fixture().payload.record), /durable session identity/u);
    opened.db.close();
  });
});
