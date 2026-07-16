import type { InteropErrorCode, InteropOperation, InteropTransferPhase } from '../../../shared/interop/contract.js';
import type { InteropCounts } from '../../../shared/interop/messages.js';

export type InteropEntryContext = 'selection' | 'album' | 'lightbox' | 'settings';
export type InteropProviderId = 'pcloud' | 'google-drive' | 'icloud-drive';
export type InteropProviderState = 'disconnected' | 'connecting' | 'connected' | 'reconnect-required' | 'unavailable';
export type InteropPairingState = 'unpaired' | 'pairing' | 'paired' | 'invalid';

export interface InteropVisibleConflict {
  readonly interopId: string;
  readonly label: string;
  readonly fields: readonly string[];
}

export interface InteropVisibleError {
  readonly code: InteropErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export interface InteropVisibleWorkflow {
  readonly entry: InteropEntryContext;
  readonly operation: InteropOperation;
  readonly target: 'image-trail' | 'overlook';
  readonly provider: {
    readonly id: InteropProviderId | null;
    readonly label: string;
    readonly state: InteropProviderState;
    readonly detail: string;
  };
  readonly pairing: InteropPairingState;
  readonly phase: InteropTransferPhase;
  readonly counts: InteropCounts;
  readonly processed: number;
  readonly conflicts: readonly InteropVisibleConflict[];
  readonly error: InteropVisibleError | null;
}

export const EMPTY_INTEROP_COUNTS: InteropCounts = Object.freeze({
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
});

export function blockedInteropWorkflow(entry: InteropEntryContext, total: number): InteropVisibleWorkflow {
  return {
    entry,
    operation: 'move',
    target: 'image-trail',
    provider: {
      id: null,
      label: 'No interop provider',
      state: 'disconnected',
      detail: 'Connect an isolated Transfer & Sync provider and import a pairing bundle before review.',
    },
    pairing: 'unpaired',
    phase: 'queued',
    counts: { ...EMPTY_INTEROP_COUNTS, total },
    processed: 0,
    conflicts: [],
    error: {
      code: 'provider-unavailable',
      message: 'Eligibility has not been checked. No records or originals have been transferred.',
      retryable: true,
    },
  };
}

export const INTEROP_REVIEW_LABELS = Object.freeze({
  eligible: 'Eligible',
  duplicate: 'Duplicate',
  conflict: 'Conflict',
  metadataOnly: 'Metadata only',
  unsupported: 'Unsupported',
  skipped: 'Skipped',
});

export function interopPhaseLabel(phase: InteropTransferPhase): string {
  return phase === 'awaiting-acknowledgement'
    ? 'Awaiting verified acknowledgement'
    : phase
        .split('-')
        .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(' ');
}

export function interopRecoveryLabel(code: InteropErrorCode): string {
  if (code === 'auth-expired') return 'Reconnect';
  if (code === 'offline' || code === 'interrupted' || code === 'partial-failure') return 'Resume';
  if (code === 'quota') return 'Review quota';
  if (code === 'wrong-key') return 'Import pairing again';
  return 'Retry check';
}
