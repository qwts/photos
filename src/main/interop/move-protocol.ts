import { randomUUID } from 'node:crypto';

import type { InteropProduct } from '../../shared/interop/contract.js';
import { interopEnvelopeSchema, type InteropEnvelope, type InteropError } from '../../shared/interop/messages.js';
import type { InteropRecord } from '../../shared/interop/records.js';
import type { InteropTranslationService } from './translation-service.js';
import {
  MoveJournalError,
  type MoveOriginalVerification,
  type StoredMoveJournal,
  type StoredMoveItem,
  type MoveJournalRepository,
} from './move-journal-repository.js';

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

export interface MoveOriginalVerifier {
  verify(record: InteropRecord): Promise<{ readonly verified: boolean; readonly targetLocalId: string | null }>;
}

export type MoveSourceOriginalAction = 'remove-after-verified-copy' | 'preserve-original';

export interface MoveSourceFinalizer {
  finalize(input: {
    readonly transferId: string;
    readonly sourceLocalId: string;
    readonly targetLocalId: string | null;
    readonly record: InteropRecord;
    readonly originalAction: MoveSourceOriginalAction;
  }): Promise<void>;
}

export interface MoveFinalizationResult {
  readonly finalized: number;
  readonly failed: number;
  readonly journal: StoredMoveJournal;
}

export class MoveProtocolError extends Error {
  override readonly name = 'MoveProtocolError';
}

interface MoveProtocolOptions {
  readonly now?: (() => string) | undefined;
  readonly createMessageId?: (() => string) | undefined;
}

function errorDetails(error: unknown): { readonly message: string } {
  return { message: error instanceof Error ? error.message : 'Move operation failed.' };
}

function originalVerificationFor(record: InteropRecord): Exclude<MoveOriginalVerification, 'pending' | 'verified'> {
  return record.original.state === 'metadata-only' ? 'metadata-only' : 'unavailable';
}

function acceptedCategory(category: StoredMoveItem['reviewCategory']): boolean {
  return category === 'eligible' || category === 'duplicate' || category === 'metadata-only';
}

export class MoveProtocolService {
  readonly #now: () => string;
  readonly #createMessageId: () => string;

  constructor(
    private readonly localProduct: InteropProduct,
    private readonly journals: MoveJournalRepository,
    private readonly translation: InteropTranslationService,
    options: MoveProtocolOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createMessageId = options.createMessageId ?? randomUUID;
  }

  queue(requestInput: InteropEnvelope): StoredMoveJournal {
    const request = this.requireRecordRequest(requestInput);
    if (request.header.sourceProduct !== this.localProduct) {
      throw new MoveProtocolError('Only the source product may queue a Move request.');
    }
    return this.journals.queueRequest(request, this.#now());
  }

  async receive(requestInput: InteropEnvelope, verifier: MoveOriginalVerifier): Promise<InteropEnvelope> {
    const request = this.requireRecordRequest(requestInput);
    if (request.header.targetProduct !== this.localProduct) {
      throw new MoveProtocolError('Only the target product may receive a Move request.');
    }
    const replayed = this.journals.responseForReceipt(request.header.pairingId, request.header.messageId);
    if (
      replayed !== undefined &&
      (replayed.header.transferId !== request.header.transferId ||
        replayed.header.pairingId !== request.header.pairingId ||
        replayed.header.sourceProduct !== request.header.targetProduct ||
        replayed.header.targetProduct !== request.header.sourceProduct)
    ) {
      throw new MoveProtocolError('Move replay identity was reused across transfer identities.');
    }
    if (
      replayed !== undefined &&
      (!isAcknowledgementEnvelope(replayed) ||
        replayed.payload.status === 'accepted' ||
        !replayed.payload.errors.some((error) => error.retryable))
    )
      return replayed;

    const at = this.#now();
    const imported = this.translation.importCanonicalPayload({
      record: request.payload.record,
      albums: request.payload.albums,
      receivedAt: at,
    });
    const reviewCategory = imported.record.reviewCategory;
    let targetLocalId: string | null = null;
    let originalVerification: Exclude<MoveOriginalVerification, 'pending'> = originalVerificationFor(request.payload.record);
    let verificationError: InteropError | null = null;

    if (request.payload.record.original.state === 'available' && imported.record.persisted && acceptedCategory(reviewCategory)) {
      try {
        const verification = await verifier.verify(request.payload.record);
        targetLocalId = verification.targetLocalId;
        if (verification.verified) {
          originalVerification = 'verified';
        } else {
          originalVerification = 'unavailable';
          verificationError = {
            code: 'partial-failure',
            message: 'Target original verification failed.',
            retryable: true,
            recordInteropId: request.payload.record.identity.interopId,
          };
        }
      } catch (error) {
        originalVerification = 'unavailable';
        verificationError = {
          code: 'partial-failure',
          message: error instanceof Error ? error.message : 'Target original verification failed.',
          retryable: true,
          recordInteropId: request.payload.record.identity.interopId,
        };
      }
    }

    const metadataPersisted = imported.record.persisted;
    const originalSatisfied = request.payload.record.original.state === 'available' ? originalVerification === 'verified' : true;
    const accepted = metadataPersisted && acceptedCategory(reviewCategory) && originalSatisfied;
    const categoryError: InteropError | null = acceptedCategory(reviewCategory)
      ? null
      : {
          code: 'unsupported-record',
          message: `Move target classified the record as ${reviewCategory}.`,
          retryable: reviewCategory === 'conflict',
          recordInteropId: request.payload.record.identity.interopId,
        };
    const errors = [categoryError, verificationError].filter((error): error is InteropError => error !== null);
    const acknowledgement = interopEnvelopeSchema.parse({
      header: {
        ...request.header,
        messageId: this.#createMessageId(),
        sourceProduct: request.header.targetProduct,
        targetProduct: request.header.sourceProduct,
        kind: 'acknowledgement',
        createdAt: at,
      },
      payload: {
        kind: 'acknowledgement',
        schemaVersion: 1,
        status: accepted ? 'accepted' : 'rejected',
        recordInteropId: request.payload.record.identity.interopId,
        targetLocalId,
        metadataPersisted,
        originalVerification,
        acknowledgedMessageIds: [request.header.messageId],
        errors,
      },
    });
    this.journals.recordTargetAcknowledgement({
      request,
      acknowledgement,
      reviewCategory,
      targetLocalId,
      metadataPersisted,
      originalVerification,
      error: errors.length === 0 ? null : errors,
      at,
    });
    return acknowledgement;
  }

  acknowledge(acknowledgementInput: InteropEnvelope): StoredMoveJournal {
    const acknowledgement = interopEnvelopeSchema.parse(acknowledgementInput);
    if (acknowledgement.header.operation !== 'move' || !isAcknowledgementEnvelope(acknowledgement)) {
      throw new MoveProtocolError('Expected a canonical Move acknowledgement.');
    }
    const response: AcknowledgementEnvelope = acknowledgement;
    if (response.header.targetProduct !== this.localProduct) {
      throw new MoveProtocolError('Only the source product may apply a Move acknowledgement.');
    }
    const existing = this.journals.getJournal(response.header.transferId);
    if (existing === undefined) throw new MoveProtocolError('Move acknowledgement has no durable source journal.');
    if (
      existing.pairingId !== response.header.pairingId ||
      existing.sourceProduct !== response.header.targetProduct ||
      existing.targetProduct !== response.header.sourceProduct
    ) {
      throw new MoveProtocolError('Move acknowledgement does not match the source transfer identity.');
    }
    if (this.journals.hasReceipt(response.header.pairingId, response.header.messageId, response.header.transferId)) return existing;

    const item = this.journals.getItem(response.header.transferId, response.payload.recordInteropId);
    if (item === undefined) throw new MoveProtocolError('Move acknowledgement does not match a queued item.');
    if (!response.payload.acknowledgedMessageIds.includes(item.sourceMessageId)) {
      throw new MoveProtocolError('Move acknowledgement does not cover the queued source message.');
    }
    if (response.payload.status === 'accepted') this.assertDurableAcknowledgement(item, response);
    return this.journals.applyAcknowledgement({
      acknowledgement: response,
      error: response.payload.errors.length === 0 ? null : response.payload.errors,
      at: this.#now(),
    });
  }

  async resumeFinalization(transferId: string, finalizer: MoveSourceFinalizer): Promise<MoveFinalizationResult> {
    const journal = this.journals.getJournal(transferId);
    if (journal === undefined) throw new MoveProtocolError(`Move journal ${transferId} does not exist.`);
    if (journal.sourceProduct !== this.localProduct) {
      throw new MoveProtocolError('Only the source product may finalize Move items.');
    }
    let finalized = 0;
    let failed = 0;
    for (const item of this.journals.pendingFinalization(transferId)) {
      if (item.record.original.state === 'available' && item.originalVerification !== 'verified') {
        throw new MoveProtocolError('Source deletion guard requires verified target original custody.');
      }
      const at = this.#now();
      this.journals.markFinalizing(transferId, item.interopId, at);
      try {
        await finalizer.finalize({
          transferId,
          sourceLocalId: item.sourceLocalId,
          targetLocalId: item.targetLocalId,
          record: item.record,
          originalAction: item.record.original.state === 'available' ? 'remove-after-verified-copy' : 'preserve-original',
        });
        this.journals.markFinalized(transferId, item.interopId, this.#now());
        finalized += 1;
      } catch (error) {
        this.journals.markFinalizationFailed(transferId, item.interopId, errorDetails(error), this.#now());
        failed += 1;
      }
    }
    const updated = this.journals.getJournal(transferId);
    if (updated === undefined) throw new MoveJournalError(`Move journal ${transferId} disappeared during finalization.`);
    return { finalized, failed, journal: updated };
  }

  private requireRecordRequest(input: InteropEnvelope): RecordEnvelope {
    const request = interopEnvelopeSchema.parse(input);
    if (request.header.operation !== 'move' || !isRecordEnvelope(request)) {
      throw new MoveProtocolError('Expected a canonical Move record request.');
    }
    const recordRequest: RecordEnvelope = request;
    return recordRequest;
  }

  private assertDurableAcknowledgement(item: StoredMoveItem, acknowledgement: AcknowledgementEnvelope): void {
    if (!acknowledgement.payload.metadataPersisted) {
      throw new MoveProtocolError('Accepted Move acknowledgement did not prove metadata durability.');
    }
    if (item.record.original.state === 'available') {
      if (acknowledgement.payload.originalVerification !== 'verified') {
        throw new MoveProtocolError('Accepted Move acknowledgement did not prove original durability.');
      }
      return;
    }
    const expected = originalVerificationFor(item.record);
    if (acknowledgement.payload.originalVerification !== expected) {
      throw new MoveProtocolError('Move acknowledgement falsely claimed original custody.');
    }
  }
}
