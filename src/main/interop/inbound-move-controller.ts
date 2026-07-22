import type { InteropReviewCategory } from '../../shared/interop/contract.js';
import type { InteropError } from '../../shared/interop/messages.js';
import { interopInboundStatusSchema, type IncomingMoveBatchStatus, type InteropInboundStatus } from '../../shared/interop/inbound-ui.js';
import type { InteropPairingState, InteropProviderState } from '../../shared/interop/runtime-state.js';
import type { PCloudConnectResult } from '../backup/pcloud/connect.js';
import type { InboundAcceptance } from './inbound-photo-importer.js';
import type { InboundMoveRuntime, IncomingMoveBatch, IncomingMoveItem } from './inbound-move-runtime.js';

interface PairingAuthority {
  state(): InteropPairingState;
  replace(bundle: unknown): InteropPairingState;
  unlock(password: Uint8Array): Promise<InteropPairingState>;
}

interface ProviderAuthority {
  state(): Promise<InteropProviderState>;
  connect(): Promise<PCloudConnectResult>;
  disconnect(): PCloudConnectResult;
}

export interface InboundMoveControllerOptions {
  readonly pairing: PairingAuthority;
  readonly provider: ProviderAuthority;
  readonly runtime: () => Pick<InboundMoveRuntime, 'refresh' | 'start'>;
  readonly pickPairingBundle: () => Promise<unknown>;
  readonly statusChanged?: ((status: InteropInboundStatus) => void) | undefined;
}

class InboundMoveCancelledError extends Error {
  override readonly name = 'InboundMoveCancelledError';
}

const categories: Readonly<Record<InteropReviewCategory, keyof IncomingMoveBatchStatus['counts']>> = {
  eligible: 'eligible',
  duplicate: 'duplicate',
  conflict: 'conflict',
  'metadata-only': 'metadataOnly',
  unsupported: 'unsupported',
  skipped: 'skipped',
};

function safeError(error: unknown): InteropError {
  const name = error instanceof Error ? error.name.toLowerCase() : '';
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (name.includes('cancelled'))
    return { code: 'interrupted', message: 'Transfer cancelled safely.', retryable: true, recordInteropId: null };
  if (message.includes('pairing') || message.includes('unlock') || message.includes('key')) {
    return { code: 'wrong-key', message: 'The pairing bundle could not be unlocked.', retryable: true, recordInteropId: null };
  }
  if (message.includes('expired') || message.includes('authorization')) {
    return { code: 'auth-expired', message: 'pCloud authorization must be renewed.', retryable: true, recordInteropId: null };
  }
  if (message.includes('offline') || message.includes('network')) {
    return { code: 'offline', message: 'pCloud is currently unavailable.', retryable: true, recordInteropId: null };
  }
  if (message.includes('version')) {
    return {
      code: 'unsupported-version',
      message: 'The incoming transfer version is not supported.',
      retryable: false,
      recordInteropId: null,
    };
  }
  if (message.includes('replay') || message.includes('reuses')) {
    return { code: 'replay', message: 'The incoming transfer reuses an existing identity.', retryable: false, recordInteropId: null };
  }
  if (message.includes('invalid') || message.includes('corrupt') || message.includes('match')) {
    return { code: 'corrupt', message: 'The incoming transfer failed integrity validation.', retryable: false, recordInteropId: null };
  }
  return { code: 'partial-failure', message: 'The transfer could not be completed safely.', retryable: true, recordInteropId: null };
}

function batchStatus(batch: IncomingMoveBatch): IncomingMoveBatchStatus {
  const counts: IncomingMoveBatchStatus['counts'] = {
    total: batch.items.length,
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
  for (const [category, count] of Object.entries(batch.counts) as [InteropReviewCategory, number][]) counts[categories[category]] = count;
  return {
    transferId: batch.transferId,
    counts,
    items: batch.items.map((item) => ({
      interopId: item.request.payload.record.identity.interopId,
      label: (
        item.request.payload.record.title?.trim() || `Image Trail capture ${item.request.payload.record.identity.interopId.slice(0, 8)}`
      ).slice(0, 160),
      reviewCategory: item.reviewCategory,
      original: item.request.payload.record.original.state,
      outcome: 'pending',
      reason: null,
    })),
  };
}

export class InboundMoveController {
  #batches: IncomingMoveBatchStatus[] = [];
  #selectedTransferId: string | null = null;
  #progress: InteropInboundStatus['progress'] = {
    transferId: null,
    phase: 'queued',
    processed: 0,
    total: 0,
    accepted: 0,
    retained: 0,
  };
  #error: InteropError | null = null;
  #run: Promise<void> | null = null;
  #paused = false;
  #cancelled = false;
  #resume: (() => void) | null = null;

  constructor(private readonly options: InboundMoveControllerOptions) {}

  async status(): Promise<InteropInboundStatus> {
    return interopInboundStatusSchema.parse({
      provider: await this.options.provider.state(),
      pairing: this.options.pairing.state(),
      batches: this.#batches,
      selectedTransferId: this.#selectedTransferId,
      progress: this.#progress,
      error: this.#error,
    });
  }

  async connectProvider(): Promise<InteropInboundStatus> {
    const result = await this.options.provider.connect();
    this.#error = result.ok ? null : safeError(new Error(result.reason ?? 'Provider connection failed.'));
    return this.publish();
  }

  async disconnectProvider(): Promise<InteropInboundStatus> {
    const result = this.options.provider.disconnect();
    this.#error = result.ok ? null : safeError(new Error(result.reason ?? 'Provider disconnect failed.'));
    if (result.ok) this.clearPreview();
    return this.publish();
  }

  async selectPairing(): Promise<InteropInboundStatus> {
    try {
      const bundle = await this.options.pickPairingBundle();
      if (bundle !== null) {
        this.options.pairing.replace(bundle);
        this.clearPreview();
      }
      this.#error = null;
    } catch (error) {
      this.#error = safeError(error);
    }
    return this.publish();
  }

  async unlockPairing(password: string): Promise<InteropInboundStatus> {
    const bytes = new TextEncoder().encode(password);
    try {
      await this.options.pairing.unlock(bytes);
      this.#error = null;
    } catch (error) {
      this.#error = safeError(error);
    } finally {
      bytes.fill(0);
    }
    return this.publish();
  }

  async refresh(): Promise<InteropInboundStatus> {
    if (this.#run !== null) return this.publish();
    try {
      const batches = await this.options.runtime().refresh();
      this.#batches = batches.map(batchStatus);
      this.#selectedTransferId = this.#batches[0]?.transferId ?? null;
      this.#progress = {
        transferId: this.#selectedTransferId,
        phase: 'reviewing',
        processed: 0,
        total: this.#batches[0]?.counts.total ?? 0,
        accepted: 0,
        retained: 0,
      };
      this.#error = null;
    } catch (error) {
      this.#error = safeError(error);
      this.#progress = { ...this.#progress, phase: 'failed' };
    }
    return this.publish();
  }

  async start(transferId: string): Promise<InteropInboundStatus> {
    if (this.#run !== null) return this.publish();
    const batch = this.#batches.find((candidate) => candidate.transferId === transferId);
    if (batch === undefined) {
      this.#error = { code: 'interrupted', message: 'Refresh incoming transfers before starting.', retryable: true, recordInteropId: null };
      return this.publish();
    }
    this.#selectedTransferId = transferId;
    this.#paused = false;
    this.#cancelled = false;
    this.#error = null;
    this.#progress = { transferId, phase: 'transferring', processed: 0, total: batch.items.length, accepted: 0, retained: 0 };
    this.#run = this.runTransfer(transferId).finally(() => {
      this.#run = null;
    });
    return this.publish();
  }

  async pause(): Promise<InteropInboundStatus> {
    if (this.#run !== null && this.#progress.phase === 'transferring') {
      this.#paused = true;
      this.#progress = { ...this.#progress, phase: 'paused' };
    }
    return this.publish();
  }

  async resume(): Promise<InteropInboundStatus> {
    if (this.#run !== null && this.#paused) {
      this.#paused = false;
      this.#progress = { ...this.#progress, phase: 'transferring' };
      this.#resume?.();
      this.#resume = null;
    }
    return this.publish();
  }

  async cancel(): Promise<InteropInboundStatus> {
    if (this.#run !== null) {
      this.#cancelled = true;
      this.#paused = false;
      this.#resume?.();
      this.#resume = null;
    }
    return this.publish();
  }

  async retry(): Promise<InteropInboundStatus> {
    if (this.#run !== null) return this.publish();
    return this.#selectedTransferId === null ? this.refresh() : this.start(this.#selectedTransferId);
  }

  async drain(): Promise<void> {
    await this.#run;
  }

  async shutdown(): Promise<void> {
    if (this.#run !== null) {
      await this.cancel();
      await this.drain();
    }
    this.clearPreview();
    this.#error = null;
  }

  private async runTransfer(transferId: string): Promise<void> {
    try {
      await this.options.runtime().start(transferId, {
        beforeItem: () => this.beforeItem(),
        itemCompleted: (item, acceptance) => this.itemCompleted(transferId, item, acceptance),
      });
      this.#progress = { ...this.#progress, phase: 'completed' };
      this.#error = null;
    } catch (error) {
      this.#error = safeError(error);
      this.#progress = { ...this.#progress, phase: error instanceof InboundMoveCancelledError ? 'cancelled' : 'failed' };
    }
    await this.publish();
  }

  private async beforeItem(): Promise<void> {
    if (this.#cancelled) throw new InboundMoveCancelledError();
    if (this.#paused) {
      await new Promise<void>((resolve) => {
        this.#resume = resolve;
      });
    }
    if (this.#cancelled) throw new InboundMoveCancelledError();
  }

  private async itemCompleted(transferId: string, item: IncomingMoveItem, acceptance: InboundAcceptance): Promise<void> {
    const interopId = item.request.payload.record.identity.interopId;
    this.#batches = this.#batches.map((batch) =>
      batch.transferId !== transferId
        ? batch
        : {
            ...batch,
            counts: { ...batch.counts, acknowledged: batch.counts.acknowledged + 1 },
            items: batch.items.map((candidate) =>
              candidate.interopId === interopId
                ? {
                    ...candidate,
                    outcome: acceptance.accepted ? 'accepted' : 'retained',
                    reason: acceptance.reason === null ? null : acceptance.reason.slice(0, 240),
                  }
                : candidate,
            ),
          },
    );
    this.#progress = {
      ...this.#progress,
      processed: this.#progress.processed + 1,
      accepted: this.#progress.accepted + (acceptance.accepted ? 1 : 0),
      retained: this.#progress.retained + (acceptance.accepted ? 0 : 1),
    };
    await this.publish();
  }

  private clearPreview(): void {
    this.#batches = [];
    this.#selectedTransferId = null;
    this.#progress = { transferId: null, phase: 'queued', processed: 0, total: 0, accepted: 0, retained: 0 };
  }

  private async publish(): Promise<InteropInboundStatus> {
    const status = await this.status();
    this.options.statusChanged?.(status);
    return status;
  }
}
