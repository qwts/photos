import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';

import { queryAll, queryGet, runNamed } from '../db/sql.js';

const timestampSchema = z.string().datetime();
const inboundObjectKindSchema = z.enum(['record-message', 'blob-message']);
const inboundObjectPhaseSchema = z.enum([
  'discovered',
  'validated',
  'blob-committed',
  'database-committed',
  'ack-journaled',
  'ack-uploaded',
  'retained',
  'failed',
]);

export type InboundObjectKind = z.output<typeof inboundObjectKindSchema>;
export type InboundObjectPhase = z.output<typeof inboundObjectPhaseSchema>;

const discoverySchema = z
  .object({
    transferId: z.string().uuid(),
    sourceMessageId: z.string().uuid(),
    objectPath: z.string().min(1).max(1024),
    objectKind: inboundObjectKindSchema,
    sequence: z.number().int().nonnegative(),
    interopId: z.string().uuid().nullable(),
    deterministicTargetId: z.string().min(1).max(255).nullable(),
    at: timestampSchema,
  })
  .strict();

export type InboundObjectDiscovery = z.input<typeof discoverySchema>;

interface InboundObjectRow {
  transfer_id: string;
  source_message_id: string;
  object_path: string;
  object_kind: string;
  sequence: number;
  interop_id: string | null;
  deterministic_target_id: string | null;
  phase: string;
  retry_count: number;
  retry_at: string | null;
  acknowledgement_message_id: string | null;
  error_json: string | null;
  discovered_at: string;
  updated_at: string;
}

export interface StoredInboundObject {
  readonly transferId: string;
  readonly sourceMessageId: string;
  readonly objectPath: string;
  readonly objectKind: InboundObjectKind;
  readonly sequence: number;
  readonly interopId: string | null;
  readonly deterministicTargetId: string | null;
  readonly phase: InboundObjectPhase;
  readonly retryCount: number;
  readonly retryAt: string | null;
  readonly acknowledgementMessageId: string | null;
  readonly error: unknown;
  readonly discoveredAt: string;
  readonly updatedAt: string;
}

export class InboundMoveObjectJournalError extends Error {
  override readonly name = 'InboundMoveObjectJournalError';
}

function parseStoredJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new InboundMoveObjectJournalError('Stored inbound Move retry error is corrupt.');
  }
}

function hydrate(row: InboundObjectRow): StoredInboundObject {
  return {
    transferId: z.string().uuid().parse(row.transfer_id),
    sourceMessageId: z.string().uuid().parse(row.source_message_id),
    objectPath: row.object_path,
    objectKind: inboundObjectKindSchema.parse(row.object_kind),
    sequence: z.number().int().nonnegative().parse(row.sequence),
    interopId: row.interop_id === null ? null : z.string().uuid().parse(row.interop_id),
    deterministicTargetId: row.deterministic_target_id,
    phase: inboundObjectPhaseSchema.parse(row.phase),
    retryCount: z.number().int().nonnegative().parse(row.retry_count),
    retryAt: row.retry_at === null ? null : timestampSchema.parse(row.retry_at),
    acknowledgementMessageId: row.acknowledgement_message_id === null ? null : z.string().uuid().parse(row.acknowledgement_message_id),
    error: row.error_json === null ? null : parseStoredJson(row.error_json),
    discoveredAt: timestampSchema.parse(row.discovered_at),
    updatedAt: timestampSchema.parse(row.updated_at),
  };
}

const allowedTransitions: Readonly<Record<InboundObjectPhase, readonly InboundObjectPhase[]>> = {
  discovered: ['validated', 'retained', 'failed'],
  validated: ['blob-committed', 'database-committed', 'retained', 'failed'],
  'blob-committed': ['database-committed', 'failed'],
  'database-committed': ['ack-journaled', 'failed'],
  'ack-journaled': ['ack-uploaded', 'failed'],
  'ack-uploaded': [],
  retained: [],
  failed: [],
};

export class InboundMoveObjectJournal {
  constructor(private readonly db: BetterSqlite3.Database) {}

  discover(input: InboundObjectDiscovery): StoredInboundObject {
    const discovery = discoverySchema.parse(input);
    runNamed(
      this.db,
      `INSERT OR IGNORE INTO interop_move_inbound_objects (
         transfer_id, source_message_id, object_path, object_kind, sequence,
         interop_id, deterministic_target_id, phase, discovered_at, updated_at
       ) VALUES (
         @transferId, @sourceMessageId, @objectPath, @objectKind, @sequence,
         @interopId, @deterministicTargetId, 'discovered', @at, @at
       )`,
      discovery,
    );
    const stored = this.require(discovery.transferId, discovery.objectPath);
    if (
      stored.sourceMessageId !== discovery.sourceMessageId ||
      stored.objectKind !== discovery.objectKind ||
      stored.sequence !== discovery.sequence ||
      stored.interopId !== discovery.interopId ||
      stored.deterministicTargetId !== discovery.deterministicTargetId
    ) {
      throw new InboundMoveObjectJournalError('Inbound Move discovery collides with an existing durable object.');
    }
    return stored;
  }

  advance(
    transferId: string,
    objectPath: string,
    phaseInput: InboundObjectPhase,
    atInput: string,
    acknowledgementMessageId: string | null = null,
  ): StoredInboundObject {
    const current = this.require(z.string().uuid().parse(transferId), z.string().min(1).max(1024).parse(objectPath));
    const phase = inboundObjectPhaseSchema.parse(phaseInput);
    const at = timestampSchema.parse(atInput);
    const ackId = acknowledgementMessageId === null ? null : z.string().uuid().parse(acknowledgementMessageId);
    if (phase !== current.phase && !allowedTransitions[current.phase].includes(phase)) {
      throw new InboundMoveObjectJournalError(`Inbound Move cannot advance from ${current.phase} to ${phase}.`);
    }
    if ((phase === 'ack-journaled' || phase === 'ack-uploaded') && ackId === null && current.acknowledgementMessageId === null) {
      throw new InboundMoveObjectJournalError('Acknowledgement phases require a durable acknowledgement message ID.');
    }
    if (ackId !== null && current.acknowledgementMessageId !== null && ackId !== current.acknowledgementMessageId) {
      throw new InboundMoveObjectJournalError('Inbound Move acknowledgement identity cannot change.');
    }
    runNamed(
      this.db,
      `UPDATE interop_move_inbound_objects
       SET phase = @phase,
           acknowledgement_message_id = COALESCE(acknowledgement_message_id, @ackId),
           retry_at = NULL,
           error_json = NULL,
           updated_at = @at
       WHERE transfer_id = @transferId AND object_path = @objectPath`,
      { transferId: current.transferId, objectPath: current.objectPath, phase, ackId, at },
    );
    return this.require(current.transferId, current.objectPath);
  }

  retry(transferId: string, objectPath: string, retryAtInput: string, error: unknown, atInput: string): StoredInboundObject {
    const current = this.require(z.string().uuid().parse(transferId), z.string().min(1).max(1024).parse(objectPath));
    if (current.phase === 'ack-uploaded' || current.phase === 'retained' || current.phase === 'failed') {
      throw new InboundMoveObjectJournalError(`Inbound Move ${current.phase} objects cannot be retried.`);
    }
    const retryAt = timestampSchema.parse(retryAtInput);
    const at = timestampSchema.parse(atInput);
    runNamed(
      this.db,
      `UPDATE interop_move_inbound_objects
       SET retry_count = retry_count + 1, retry_at = @retryAt,
           error_json = @errorJson, updated_at = @at
       WHERE transfer_id = @transferId AND object_path = @objectPath`,
      { transferId: current.transferId, objectPath: current.objectPath, retryAt, errorJson: JSON.stringify(error ?? null), at },
    );
    return this.require(current.transferId, current.objectPath);
  }

  pending(atInput: string): readonly StoredInboundObject[] {
    const at = timestampSchema.parse(atInput);
    return queryAll<InboundObjectRow>(
      this.db,
      `SELECT * FROM interop_move_inbound_objects
       WHERE phase NOT IN ('ack-uploaded', 'retained', 'failed') AND (retry_at IS NULL OR retry_at <= @at)
       ORDER BY transfer_id, sequence, object_path`,
      { at },
    ).map(hydrate);
  }

  require(transferId: string, objectPath: string): StoredInboundObject {
    const row = queryGet<InboundObjectRow>(
      this.db,
      'SELECT * FROM interop_move_inbound_objects WHERE transfer_id = ? AND object_path = ?',
      transferId,
      objectPath,
    );
    if (row === undefined) throw new InboundMoveObjectJournalError('Inbound Move object is not journaled.');
    return hydrate(row);
  }
}
