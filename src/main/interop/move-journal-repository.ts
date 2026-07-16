import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';

import { queryAll, queryGet, runNamed } from '../db/sql.js';
import {
  interopProductSchema,
  interopReviewCategorySchema,
  interopTransferPhaseSchema,
  type InteropProduct,
  type InteropReviewCategory,
  type InteropTransferPhase,
} from '../../shared/interop/contract.js';
import { interopCountsSchema, interopEnvelopeSchema, type InteropCounts, type InteropEnvelope } from '../../shared/interop/messages.js';
import { interopRecordSchema, type InteropRecord } from '../../shared/interop/records.js';

type RecordEnvelope = Omit<InteropEnvelope, 'payload'> & {
  readonly payload: Extract<InteropEnvelope['payload'], { readonly kind: 'record' }>;
};
type AcknowledgementEnvelope = Omit<InteropEnvelope, 'payload'> & {
  readonly payload: Extract<InteropEnvelope['payload'], { readonly kind: 'acknowledgement' }>;
};

function isRecordEnvelope(envelope: InteropEnvelope): envelope is RecordEnvelope {
  return envelope.payload.kind === 'record';
}

function isAcknowledgementEnvelope(envelope: InteropEnvelope): envelope is AcknowledgementEnvelope {
  return envelope.payload.kind === 'acknowledgement';
}

const timestampSchema = z.string().datetime();
const moveItemStateSchema = z.enum(['queued', 'received', 'acknowledged', 'finalizing', 'finalized', 'rejected', 'failed']);
const originalVerificationSchema = z.enum(['pending', 'verified', 'metadata-only', 'unavailable']);
const auditEventSchema = z.enum(['queued', 'received', 'acknowledged', 'rejected', 'finalizing', 'finalized', 'failed']);
const messageIdsSchema = z.array(z.string().uuid()).readonly();

export type MoveItemState = z.output<typeof moveItemStateSchema>;
export type MoveOriginalVerification = z.output<typeof originalVerificationSchema>;
export type MoveAuditEvent = z.output<typeof auditEventSchema>;

interface MoveJournalRow {
  transfer_id: string;
  pairing_id: string;
  source_product: string;
  target_product: string;
  phase: string;
  last_sequence: number;
  created_at: string;
  updated_at: string;
}

interface MoveItemRow {
  transfer_id: string;
  interop_id: string;
  source_message_id: string;
  source_local_id: string;
  review_category: string;
  record_json: string;
  state: string;
  target_local_id: string | null;
  metadata_persisted: number;
  original_verification: string;
  acknowledgement_message_id: string | null;
  acknowledged_message_ids_json: string;
  error_json: string | null;
  received_at: string | null;
  acknowledged_at: string | null;
  finalized_at: string | null;
}

interface OutboxRow {
  envelope_json: string;
}

interface AuditRow {
  event_key: string;
  transfer_id: string;
  interop_id: string | null;
  event: string;
  details_json: string;
  created_at: string;
}

export interface StoredMoveItem {
  readonly transferId: string;
  readonly interopId: string;
  readonly sourceMessageId: string;
  readonly sourceLocalId: string;
  readonly reviewCategory: InteropReviewCategory;
  readonly record: InteropRecord;
  readonly state: MoveItemState;
  readonly targetLocalId: string | null;
  readonly metadataPersisted: boolean;
  readonly originalVerification: MoveOriginalVerification;
  readonly acknowledgementMessageId: string | null;
  readonly acknowledgedMessageIds: readonly string[];
  readonly error: unknown;
  readonly receivedAt: string | null;
  readonly acknowledgedAt: string | null;
  readonly finalizedAt: string | null;
}

export interface StoredMoveJournal {
  readonly transferId: string;
  readonly pairingId: string;
  readonly sourceProduct: InteropProduct;
  readonly targetProduct: InteropProduct;
  readonly phase: InteropTransferPhase;
  readonly lastSequence: number;
  readonly counts: InteropCounts;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoredMoveAuditEvent {
  readonly eventKey: string;
  readonly transferId: string;
  readonly interopId: string | null;
  readonly event: MoveAuditEvent;
  readonly details: unknown;
  readonly createdAt: string;
}

export class MoveJournalError extends Error {
  override readonly name = 'MoveJournalError';
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new MoveJournalError('Stored Move journal JSON is corrupt.');
  }
}

function optionalTimestamp(value: string | null): string | null {
  return value === null ? null : timestampSchema.parse(value);
}

function hydrateItem(row: MoveItemRow): StoredMoveItem {
  const record = interopRecordSchema.parse(parseJson(row.record_json));
  if (record.identity.interopId !== row.interop_id || record.identity.origin.localId !== row.source_local_id) {
    throw new MoveJournalError('Stored Move item index does not match its canonical record.');
  }
  return {
    transferId: z.string().uuid().parse(row.transfer_id),
    interopId: z.string().uuid().parse(row.interop_id),
    sourceMessageId: z.string().uuid().parse(row.source_message_id),
    sourceLocalId: row.source_local_id,
    reviewCategory: interopReviewCategorySchema.parse(row.review_category),
    record,
    state: moveItemStateSchema.parse(row.state),
    targetLocalId: row.target_local_id,
    metadataPersisted: row.metadata_persisted === 1,
    originalVerification: originalVerificationSchema.parse(row.original_verification),
    acknowledgementMessageId: row.acknowledgement_message_id === null ? null : z.string().uuid().parse(row.acknowledgement_message_id),
    acknowledgedMessageIds: messageIdsSchema.parse(parseJson(row.acknowledged_message_ids_json)),
    error: row.error_json === null ? null : parseJson(row.error_json),
    receivedAt: optionalTimestamp(row.received_at),
    acknowledgedAt: optionalTimestamp(row.acknowledged_at),
    finalizedAt: optionalTimestamp(row.finalized_at),
  };
}

function emptyCounts(): InteropCounts {
  return {
    total: 0,
    eligible: 0,
    duplicate: 0,
    conflict: 0,
    metadataOnly: 0,
    unsupported: 0,
    skipped: 0,
    failed: 0,
    acknowledged: 0,
    finalized: 0,
  };
}

function countsFor(items: readonly StoredMoveItem[]): InteropCounts {
  const counts = emptyCounts();
  for (const item of items) {
    counts.total += 1;
    switch (item.reviewCategory) {
      case 'eligible':
        counts.eligible += 1;
        break;
      case 'duplicate':
        counts.duplicate += 1;
        break;
      case 'conflict':
        counts.conflict += 1;
        break;
      case 'metadata-only':
        counts.metadataOnly += 1;
        break;
      case 'unsupported':
        counts.unsupported += 1;
        break;
      case 'skipped':
        counts.skipped += 1;
        break;
    }
    if (item.state === 'failed' || item.state === 'rejected') counts.failed += 1;
    if (item.acknowledgedAt !== null) counts.acknowledged += 1;
    if (item.finalizedAt !== null) counts.finalized += 1;
  }
  return interopCountsSchema.parse(counts);
}

function hydrateEnvelope(row: OutboxRow | undefined): InteropEnvelope | undefined {
  return row === undefined ? undefined : interopEnvelopeSchema.parse(parseJson(row.envelope_json));
}

export class MoveJournalRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  queueRequest(envelopeInput: InteropEnvelope, atInput: string): StoredMoveJournal {
    const envelope = interopEnvelopeSchema.parse(envelopeInput);
    const at = timestampSchema.parse(atInput);
    if (envelope.header.operation !== 'move' || !isRecordEnvelope(envelope)) {
      throw new MoveJournalError('Move outbox accepts only canonical Move record messages.');
    }
    const request: RecordEnvelope = envelope;
    this.db.transaction(() => {
      this.ensureJournal(request, 'awaiting-acknowledgement', at);
      runNamed(
        this.db,
        `INSERT OR IGNORE INTO interop_move_items (
           transfer_id, interop_id, source_message_id, source_local_id, review_category, record_json, state
         ) VALUES (
           @transferId, @interopId, @sourceMessageId, @sourceLocalId, @reviewCategory, @recordJson, 'queued'
         )`,
        {
          transferId: request.header.transferId,
          interopId: request.payload.record.identity.interopId,
          sourceMessageId: request.header.messageId,
          sourceLocalId: request.payload.record.identity.origin.localId,
          reviewCategory: request.payload.reviewCategory,
          recordJson: JSON.stringify(request.payload.record),
        },
      );
      this.assertSameQueuedRequest(request);
      this.putOutbox(request, at);
      this.putAudit({
        eventKey: `${request.header.messageId}:queued`,
        transferId: request.header.transferId,
        interopId: request.payload.record.identity.interopId,
        event: 'queued',
        details: { sourceMessageId: request.header.messageId },
        at,
      });
    })();
    return this.requireJournal(request.header.transferId);
  }

  recordTargetAcknowledgement(input: {
    readonly request: InteropEnvelope;
    readonly acknowledgement: InteropEnvelope;
    readonly reviewCategory: InteropReviewCategory;
    readonly targetLocalId: string | null;
    readonly metadataPersisted: boolean;
    readonly originalVerification: Exclude<MoveOriginalVerification, 'pending'>;
    readonly error: unknown;
    readonly at: string;
  }): StoredMoveJournal {
    const request = interopEnvelopeSchema.parse(input.request);
    const acknowledgement = interopEnvelopeSchema.parse(input.acknowledgement);
    const at = timestampSchema.parse(input.at);
    if (!isRecordEnvelope(request) || !isAcknowledgementEnvelope(acknowledgement)) {
      throw new MoveJournalError('Move receipt requires a record request and acknowledgement response.');
    }
    const recordRequest: RecordEnvelope = request;
    const acknowledgementResponse: AcknowledgementEnvelope = acknowledgement;
    const accepted = acknowledgementResponse.payload.status === 'accepted';
    this.db.transaction(() => {
      this.ensureJournal(recordRequest, accepted ? 'acknowledged' : 'failed', at);
      runNamed(
        this.db,
        `INSERT INTO interop_move_items (
           transfer_id, interop_id, source_message_id, source_local_id, review_category, record_json,
           state, target_local_id, metadata_persisted, original_verification,
           acknowledgement_message_id, acknowledged_message_ids_json, error_json, received_at, acknowledged_at
         ) VALUES (
           @transferId, @interopId, @sourceMessageId, @sourceLocalId, @reviewCategory, @recordJson,
           @state, @targetLocalId, @metadataPersisted, @originalVerification,
           @acknowledgementMessageId, @acknowledgedMessageIdsJson, @errorJson, @at, @acknowledgedAt
         )
         ON CONFLICT (transfer_id, interop_id) DO UPDATE SET
           state = excluded.state,
           target_local_id = excluded.target_local_id,
           metadata_persisted = excluded.metadata_persisted,
           original_verification = excluded.original_verification,
           acknowledgement_message_id = excluded.acknowledgement_message_id,
           acknowledged_message_ids_json = excluded.acknowledged_message_ids_json,
           error_json = excluded.error_json,
           received_at = COALESCE(interop_move_items.received_at, excluded.received_at),
           acknowledged_at = excluded.acknowledged_at`,
        {
          transferId: recordRequest.header.transferId,
          interopId: recordRequest.payload.record.identity.interopId,
          sourceMessageId: recordRequest.header.messageId,
          sourceLocalId: recordRequest.payload.record.identity.origin.localId,
          reviewCategory: interopReviewCategorySchema.parse(input.reviewCategory),
          recordJson: JSON.stringify(recordRequest.payload.record),
          state: accepted ? 'acknowledged' : 'rejected',
          targetLocalId: input.targetLocalId,
          metadataPersisted: input.metadataPersisted ? 1 : 0,
          originalVerification: originalVerificationSchema.parse(input.originalVerification),
          acknowledgementMessageId: acknowledgementResponse.header.messageId,
          acknowledgedMessageIdsJson: JSON.stringify(acknowledgementResponse.payload.acknowledgedMessageIds),
          errorJson: input.error === null ? null : JSON.stringify(input.error),
          at,
          acknowledgedAt: accepted ? at : null,
        },
      );
      this.putOutbox(acknowledgementResponse, at);
      runNamed(
        this.db,
        `UPDATE interop_move_outbox SET delivered_at = COALESCE(delivered_at, @at)
         WHERE message_id = (
           SELECT response_message_id FROM interop_move_receipts
           WHERE pairing_id = @pairingId AND message_id = @messageId
         )`,
        {
          pairingId: recordRequest.header.pairingId,
          messageId: recordRequest.header.messageId,
          at,
        },
      );
      runNamed(
        this.db,
        `INSERT INTO interop_move_receipts (
           pairing_id, message_id, transfer_id, response_message_id, received_at
         ) VALUES (@pairingId, @messageId, @transferId, @responseMessageId, @at)
         ON CONFLICT (pairing_id, message_id) DO UPDATE SET
           response_message_id = excluded.response_message_id,
           received_at = excluded.received_at`,
        {
          pairingId: recordRequest.header.pairingId,
          messageId: recordRequest.header.messageId,
          transferId: recordRequest.header.transferId,
          responseMessageId: acknowledgementResponse.header.messageId,
          at,
        },
      );
      this.putAudit({
        eventKey: `${recordRequest.header.messageId}:received`,
        transferId: recordRequest.header.transferId,
        interopId: recordRequest.payload.record.identity.interopId,
        event: 'received',
        details: { metadataPersisted: input.metadataPersisted, originalVerification: input.originalVerification },
        at,
      });
      this.putAudit({
        eventKey: `${acknowledgementResponse.header.messageId}:${accepted ? 'acknowledged' : 'rejected'}`,
        transferId: recordRequest.header.transferId,
        interopId: recordRequest.payload.record.identity.interopId,
        event: accepted ? 'acknowledged' : 'rejected',
        details: { acknowledgementMessageId: acknowledgementResponse.header.messageId },
        at,
      });
    })();
    return this.requireJournal(recordRequest.header.transferId);
  }

  applyAcknowledgement(input: {
    readonly acknowledgement: InteropEnvelope;
    readonly error: unknown;
    readonly at: string;
  }): StoredMoveJournal {
    const acknowledgement = interopEnvelopeSchema.parse(input.acknowledgement);
    const at = timestampSchema.parse(input.at);
    if (!isAcknowledgementEnvelope(acknowledgement)) {
      throw new MoveJournalError('Expected a Move acknowledgement message.');
    }
    const response: AcknowledgementEnvelope = acknowledgement;
    const item = this.requireItem(response.header.transferId, response.payload.recordInteropId);
    const accepted = response.payload.status === 'accepted';
    this.db.transaction(() => {
      runNamed(
        this.db,
        `UPDATE interop_move_items SET
           state = @state,
           target_local_id = @targetLocalId,
           metadata_persisted = @metadataPersisted,
           original_verification = @originalVerification,
           acknowledgement_message_id = @acknowledgementMessageId,
           acknowledged_message_ids_json = @acknowledgedMessageIdsJson,
           error_json = @errorJson,
           acknowledged_at = @acknowledgedAt
         WHERE transfer_id = @transferId AND interop_id = @interopId`,
        {
          transferId: item.transferId,
          interopId: item.interopId,
          state: accepted ? 'acknowledged' : 'rejected',
          targetLocalId: response.payload.targetLocalId,
          metadataPersisted: response.payload.metadataPersisted ? 1 : 0,
          originalVerification: response.payload.originalVerification,
          acknowledgementMessageId: response.header.messageId,
          acknowledgedMessageIdsJson: JSON.stringify(response.payload.acknowledgedMessageIds),
          errorJson: input.error === null ? null : JSON.stringify(input.error),
          acknowledgedAt: accepted ? at : null,
        },
      );
      runNamed(
        this.db,
        `INSERT OR IGNORE INTO interop_move_receipts (
           pairing_id, message_id, transfer_id, response_message_id, received_at
         ) VALUES (@pairingId, @messageId, @transferId, NULL, @at)`,
        {
          pairingId: response.header.pairingId,
          messageId: response.header.messageId,
          transferId: response.header.transferId,
          at,
        },
      );
      this.updateJournal(response.header.transferId, accepted ? 'acknowledged' : 'failed', response.header.sequence, at);
      this.putAudit({
        eventKey: `${response.header.messageId}:${accepted ? 'acknowledged' : 'rejected'}`,
        transferId: response.header.transferId,
        interopId: response.payload.recordInteropId,
        event: accepted ? 'acknowledged' : 'rejected',
        details: { acknowledgementMessageId: response.header.messageId },
        at,
      });
    })();
    return this.requireJournal(response.header.transferId);
  }

  markFinalizing(transferId: string, interopId: string, atInput: string): void {
    const at = timestampSchema.parse(atInput);
    this.db.transaction(() => {
      runNamed(
        this.db,
        `UPDATE interop_move_items SET state = 'finalizing', error_json = NULL
         WHERE transfer_id = @transferId AND interop_id = @interopId AND acknowledged_at IS NOT NULL`,
        { transferId, interopId },
      );
      this.updateJournal(transferId, 'finalizing', undefined, at);
      this.putAudit({
        eventKey: `${transferId}:${interopId}:finalizing`,
        transferId,
        interopId,
        event: 'finalizing',
        details: {},
        at,
      });
    })();
  }

  markFinalized(transferId: string, interopId: string, atInput: string): void {
    const at = timestampSchema.parse(atInput);
    this.db.transaction(() => {
      runNamed(
        this.db,
        `UPDATE interop_move_items SET state = 'finalized', error_json = NULL, finalized_at = COALESCE(finalized_at, @at)
         WHERE transfer_id = @transferId AND interop_id = @interopId AND acknowledged_at IS NOT NULL`,
        { transferId, interopId, at },
      );
      this.putAudit({
        eventKey: `${transferId}:${interopId}:finalized`,
        transferId,
        interopId,
        event: 'finalized',
        details: {},
        at,
      });
      const remaining = queryGet<{ count: number }>(
        this.db,
        `SELECT count(*) AS count FROM interop_move_items
         WHERE transfer_id = ? AND acknowledged_at IS NOT NULL AND finalized_at IS NULL`,
        transferId,
      )?.count;
      this.updateJournal(transferId, remaining === 0 ? 'completed' : 'finalizing', undefined, at);
    })();
  }

  markFinalizationFailed(transferId: string, interopId: string, error: unknown, atInput: string): void {
    const at = timestampSchema.parse(atInput);
    this.db.transaction(() => {
      runNamed(
        this.db,
        `UPDATE interop_move_items SET state = 'failed', error_json = @errorJson
         WHERE transfer_id = @transferId AND interop_id = @interopId AND acknowledged_at IS NOT NULL`,
        { transferId, interopId, errorJson: JSON.stringify(error) },
      );
      this.updateJournal(transferId, 'failed', undefined, at);
      this.putAudit({
        eventKey: `${transferId}:${interopId}:failed:${at}`,
        transferId,
        interopId,
        event: 'failed',
        details: error,
        at,
      });
    })();
  }

  getJournal(transferId: string): StoredMoveJournal | undefined {
    const row = queryGet<MoveJournalRow>(this.db, 'SELECT * FROM interop_move_journals WHERE transfer_id = ?', transferId);
    if (row === undefined) return undefined;
    return {
      transferId: z.string().uuid().parse(row.transfer_id),
      pairingId: z.string().uuid().parse(row.pairing_id),
      sourceProduct: interopProductSchema.parse(row.source_product),
      targetProduct: interopProductSchema.parse(row.target_product),
      phase: interopTransferPhaseSchema.parse(row.phase),
      lastSequence: z.number().int().nonnegative().parse(row.last_sequence),
      counts: countsFor(this.items(transferId)),
      createdAt: timestampSchema.parse(row.created_at),
      updatedAt: timestampSchema.parse(row.updated_at),
    };
  }

  getItem(transferId: string, interopId: string): StoredMoveItem | undefined {
    const row = queryGet<MoveItemRow>(
      this.db,
      'SELECT * FROM interop_move_items WHERE transfer_id = ? AND interop_id = ?',
      transferId,
      interopId,
    );
    return row === undefined ? undefined : hydrateItem(row);
  }

  items(transferId: string): readonly StoredMoveItem[] {
    return queryAll<MoveItemRow>(this.db, 'SELECT * FROM interop_move_items WHERE transfer_id = @transferId ORDER BY interop_id', {
      transferId,
    }).map(hydrateItem);
  }

  pendingFinalization(transferId: string): readonly StoredMoveItem[] {
    return queryAll<MoveItemRow>(
      this.db,
      `SELECT * FROM interop_move_items
       WHERE transfer_id = @transferId AND acknowledged_at IS NOT NULL AND finalized_at IS NULL
       ORDER BY interop_id`,
      { transferId },
    ).map(hydrateItem);
  }

  responseForReceipt(pairingId: string, messageId: string): InteropEnvelope | undefined {
    return hydrateEnvelope(
      queryGet<OutboxRow>(
        this.db,
        `SELECT o.envelope_json FROM interop_move_receipts r
         JOIN interop_move_outbox o ON o.message_id = r.response_message_id
         WHERE r.pairing_id = ? AND r.message_id = ?`,
        pairingId,
        messageId,
      ),
    );
  }

  hasReceipt(pairingId: string, messageId: string): boolean {
    return (
      queryGet<{ one: number }>(
        this.db,
        'SELECT 1 AS one FROM interop_move_receipts WHERE pairing_id = ? AND message_id = ?',
        pairingId,
        messageId,
      ) !== undefined
    );
  }

  pendingOutbox(transferId: string): readonly InteropEnvelope[] {
    return queryAll<OutboxRow>(
      this.db,
      `SELECT envelope_json FROM interop_move_outbox
       WHERE transfer_id = @transferId AND delivered_at IS NULL
       ORDER BY sequence, message_id`,
      { transferId },
    ).map((row) => interopEnvelopeSchema.parse(parseJson(row.envelope_json)));
  }

  markDelivered(messageId: string, atInput: string): void {
    runNamed(this.db, 'UPDATE interop_move_outbox SET delivered_at = COALESCE(delivered_at, @at) WHERE message_id = @messageId', {
      messageId,
      at: timestampSchema.parse(atInput),
    });
  }

  audit(transferId: string): readonly StoredMoveAuditEvent[] {
    return queryAll<AuditRow>(this.db, 'SELECT * FROM interop_move_audit WHERE transfer_id = @transferId ORDER BY created_at, event_key', {
      transferId,
    }).map((row) => ({
      eventKey: row.event_key,
      transferId: z.string().uuid().parse(row.transfer_id),
      interopId: row.interop_id === null ? null : z.string().uuid().parse(row.interop_id),
      event: auditEventSchema.parse(row.event),
      details: parseJson(row.details_json),
      createdAt: timestampSchema.parse(row.created_at),
    }));
  }

  private requireJournal(transferId: string): StoredMoveJournal {
    const journal = this.getJournal(transferId);
    if (journal === undefined) throw new MoveJournalError(`Move journal ${transferId} does not exist.`);
    return journal;
  }

  private requireItem(transferId: string, interopId: string): StoredMoveItem {
    const item = this.getItem(transferId, interopId);
    if (item === undefined) throw new MoveJournalError('Move acknowledgement does not match a queued source item.');
    return item;
  }

  private ensureJournal(envelope: InteropEnvelope, phase: InteropTransferPhase, at: string): void {
    runNamed(
      this.db,
      `INSERT OR IGNORE INTO interop_move_journals (
         transfer_id, pairing_id, source_product, target_product, phase, last_sequence, created_at, updated_at
       ) VALUES (
         @transferId, @pairingId, @sourceProduct, @targetProduct, @phase, @lastSequence, @at, @at
       )`,
      {
        transferId: envelope.header.transferId,
        pairingId: envelope.header.pairingId,
        sourceProduct: envelope.header.sourceProduct,
        targetProduct: envelope.header.targetProduct,
        phase,
        lastSequence: envelope.header.sequence,
        at,
      },
    );
    const journal = this.requireJournal(envelope.header.transferId);
    if (
      journal.pairingId !== envelope.header.pairingId ||
      journal.sourceProduct !== envelope.header.sourceProduct ||
      journal.targetProduct !== envelope.header.targetProduct
    ) {
      throw new MoveJournalError('Move message does not match the durable transfer identity.');
    }
    this.updateJournal(envelope.header.transferId, phase, envelope.header.sequence, at);
  }

  private assertSameQueuedRequest(envelope: RecordEnvelope): void {
    const item = this.requireItem(envelope.header.transferId, envelope.payload.record.identity.interopId);
    if (
      item.sourceMessageId !== envelope.header.messageId ||
      JSON.stringify(item.record) !== JSON.stringify(envelope.payload.record) ||
      item.reviewCategory !== envelope.payload.reviewCategory
    ) {
      throw new MoveJournalError('Move item identity was replayed with different content.');
    }
  }

  private putOutbox(envelope: InteropEnvelope, at: string): void {
    runNamed(
      this.db,
      `INSERT OR IGNORE INTO interop_move_outbox (
         message_id, transfer_id, sequence, kind, envelope_json, created_at
       ) VALUES (@messageId, @transferId, @sequence, @kind, @envelopeJson, @at)`,
      {
        messageId: envelope.header.messageId,
        transferId: envelope.header.transferId,
        sequence: envelope.header.sequence,
        kind: envelope.header.kind,
        envelopeJson: JSON.stringify(envelope),
        at,
      },
    );
    const stored = hydrateEnvelope(
      queryGet<OutboxRow>(this.db, 'SELECT envelope_json FROM interop_move_outbox WHERE message_id = ?', envelope.header.messageId),
    );
    if (stored === undefined || JSON.stringify(stored) !== JSON.stringify(envelope)) {
      throw new MoveJournalError('Move outbox message id was reused with different content.');
    }
  }

  private updateJournal(transferId: string, phase: InteropTransferPhase, lastSequence: number | undefined, at: string): void {
    runNamed(
      this.db,
      `UPDATE interop_move_journals SET
         phase = @phase,
         last_sequence = max(last_sequence, @lastSequence),
         updated_at = @at
       WHERE transfer_id = @transferId`,
      { transferId, phase, lastSequence: lastSequence ?? 0, at },
    );
  }

  private putAudit(input: {
    readonly eventKey: string;
    readonly transferId: string;
    readonly interopId: string | null;
    readonly event: MoveAuditEvent;
    readonly details: unknown;
    readonly at: string;
  }): void {
    runNamed(
      this.db,
      `INSERT OR IGNORE INTO interop_move_audit (
         event_key, transfer_id, interop_id, event, details_json, created_at
       ) VALUES (@eventKey, @transferId, @interopId, @event, @detailsJson, @at)`,
      {
        eventKey: input.eventKey,
        transferId: input.transferId,
        interopId: input.interopId,
        event: auditEventSchema.parse(input.event),
        detailsJson: JSON.stringify(input.details),
        at: timestampSchema.parse(input.at),
      },
    );
  }
}
