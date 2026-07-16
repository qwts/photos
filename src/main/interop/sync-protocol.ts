import type { InteropConflictAction, InteropProduct } from '../../shared/interop/contract.js';
import { interopEnvelopeSchema, type InteropEnvelope } from '../../shared/interop/messages.js';
import type { InteropRecord } from '../../shared/interop/records.js';
import {
  analyzeSyncRecords,
  resolveSyncConflicts,
  type SyncAnalysis,
  type SyncApplyOutcome,
  type SyncField,
} from '../../shared/interop/sync-resolution.js';
import type { SyncRepository, StoredSyncItem, StoredSyncSession, SyncDeleteDecision, SyncDirection, SyncScope } from './sync-repository.js';

export interface SyncApplyRequest extends SyncApplyOutcome {
  readonly sessionId: string;
  readonly interopId: string;
  readonly deleteApproved: boolean;
}

export interface SyncRecordApplier {
  apply(input: SyncApplyRequest): Promise<void>;
}

interface SyncProtocolOptions {
  readonly now?: (() => string) | undefined;
}

export class SyncProtocolError extends Error {
  override readonly name = 'SyncProtocolError';
}

function singleRecordAnalysis(record: InteropRecord): SyncAnalysis {
  return {
    category: record.deletedAt === null ? 'eligible' : 'delete-review',
    merged: record,
    conflicts: [],
  };
}

function sameParticipants(session: StoredSyncSession, source: InteropProduct, target: InteropProduct): boolean {
  return (
    (session.sourceProduct === source && session.targetProduct === target) ||
    (session.direction === 'two-way' && session.sourceProduct === target && session.targetProduct === source)
  );
}

function hasTombstone(item: StoredSyncItem): boolean {
  return (
    (item.imageTrailRecord !== null && item.imageTrailRecord.deletedAt !== null) ||
    (item.overlookRecord !== null && item.overlookRecord.deletedAt !== null)
  );
}

export class SyncProtocolService {
  readonly #now: () => string;

  constructor(
    private readonly localProduct: InteropProduct,
    private readonly repository: SyncRepository,
    options: SyncProtocolOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  start(input: {
    readonly sessionId: string;
    readonly pairingId: string;
    readonly sourceProduct: InteropProduct;
    readonly targetProduct: InteropProduct;
    readonly direction: SyncDirection;
    readonly scope: SyncScope;
  }): StoredSyncSession {
    if (input.sourceProduct !== this.localProduct && input.targetProduct !== this.localProduct) {
      throw new SyncProtocolError('Local product must participate in the Sync session.');
    }
    return this.repository.createSession({ ...input, at: this.#now() });
  }

  receive(sessionId: string, envelopeInput: InteropEnvelope, localRecord: InteropRecord | null): StoredSyncItem {
    const envelope = interopEnvelopeSchema.parse(envelopeInput);
    if (envelope.header.operation !== 'sync' || envelope.payload.kind !== 'record') {
      throw new SyncProtocolError('Sync receive accepts only canonical Sync record messages.');
    }
    const session = this.repository.getSession(sessionId);
    if (session === undefined) throw new SyncProtocolError('Sync session does not exist.');
    if (
      envelope.header.transferId !== sessionId ||
      session.pairingId !== envelope.header.pairingId ||
      !sameParticipants(session, envelope.header.sourceProduct, envelope.header.targetProduct) ||
      envelope.header.targetProduct !== this.localProduct
    ) {
      throw new SyncProtocolError('Sync message does not match the durable session identity.');
    }
    const replay = this.repository.itemForReceipt(envelope.header.pairingId, envelope.header.messageId, envelope);
    if (replay !== undefined) return replay;

    const remoteRecord = envelope.payload.record;
    if (localRecord !== null && localRecord.identity.interopId !== remoteRecord.identity.interopId) {
      throw new SyncProtocolError('Local and remote Sync records must share one canonical identity.');
    }
    const imageTrailRecord = envelope.header.sourceProduct === 'image-trail' ? remoteRecord : localRecord;
    const overlookRecord = envelope.header.sourceProduct === 'overlook' ? remoteRecord : localRecord;
    const analysis =
      imageTrailRecord === null || overlookRecord === null
        ? singleRecordAnalysis(remoteRecord)
        : analyzeSyncRecords(imageTrailRecord, overlookRecord);
    const item = this.repository.putItem({ sessionId, imageTrailRecord, overlookRecord, analysis, at: this.#now() });
    this.repository.recordReceipt(sessionId, envelope, this.#now());
    return item;
  }

  decide(sessionId: string, interopId: string, field: SyncField, action: InteropConflictAction, applyToAll = false): StoredSyncItem {
    return this.repository.decide(sessionId, interopId, field, action, applyToAll, this.#now());
  }

  reviewDelete(sessionId: string, interopId: string, decision: SyncDeleteDecision): StoredSyncItem {
    return this.repository.reviewDelete(sessionId, interopId, decision, this.#now());
  }

  pause(sessionId: string): StoredSyncSession {
    return this.repository.setControl(sessionId, 'pause', this.#now());
  }

  resume(sessionId: string): StoredSyncSession {
    return this.repository.setControl(sessionId, 'resume', this.#now());
  }

  cancel(sessionId: string): StoredSyncSession {
    return this.repository.setControl(sessionId, 'cancel', this.#now());
  }

  disconnect(sessionId: string): StoredSyncSession {
    return this.repository.setControl(sessionId, 'disconnect', this.#now());
  }

  async apply(sessionId: string, interopId: string, applier: SyncRecordApplier): Promise<StoredSyncItem> {
    this.repository.activeSession(sessionId);
    const item = this.repository.getItem(sessionId, interopId);
    if (item === undefined) throw new SyncProtocolError('Sync item does not exist.');
    if (item.state === 'applied' || item.state === 'skipped') return item;
    if (item.state === 'duplicate') return this.repository.markApplied(sessionId, interopId, this.#now());
    if (item.state !== 'eligible' && item.state !== 'ready') {
      throw new SyncProtocolError('Sync item still requires conflict or delete review.');
    }
    if (hasTombstone(item) && item.deleteDecision !== 'apply') {
      throw new SyncProtocolError('Sync deletion requires explicit approval.');
    }
    const imageTrail = item.imageTrailRecord;
    const overlook = item.overlookRecord;
    const outcome =
      imageTrail === null || overlook === null
        ? { primary: item.analysis.merged, secondary: null }
        : resolveSyncConflicts(item.analysis, imageTrail, overlook, item.decisions);
    try {
      await applier.apply({
        ...outcome,
        sessionId,
        interopId,
        deleteApproved: item.deleteDecision === 'apply',
      });
      return this.repository.markApplied(sessionId, interopId, this.#now());
    } catch (error) {
      this.repository.markFailed(
        sessionId,
        interopId,
        { message: error instanceof Error ? error.message : 'Sync apply failed.' },
        this.#now(),
      );
      throw error;
    }
  }
}
