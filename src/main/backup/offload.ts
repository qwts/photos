import type { Readable } from 'node:stream';

import { ProviderError, type ProviderAuthState, type StorageProvider } from './provider.js';
import type { SyncLedger } from './sync-ledger.js';
import type { SyncStatus } from '../../shared/library/types.js';

// Offload + rehydrate (#107, ADR-0007): originals live only in the cloud,
// safely, and come back when needed. Eligibility trusts the verified bit
// (#106): only synced-and-clean rows evict; thumbnails always stay so the
// library browses offline. Rehydrate is atomic — download, restore staged,
// decrypt-and-rehash verify, only then flip the ledger; any failure leaves
// a clean offloaded record, never a half-restored one.

export type OffloadSkipReason =
  | 'missing-photo'
  | 'deleted'
  | 'provider-disconnected'
  | 'provider-expired'
  | 'provider-offline'
  | 'local'
  | 'syncing'
  | 'already-offloaded'
  | 'error'
  | 'dirty'
  | 'shared-original'
  | 'missing-original';

export interface OffloadPreflightItem {
  readonly photoId: string;
  readonly bytes: number;
  readonly eligible: boolean;
  readonly reason: OffloadSkipReason | null;
}

export interface OffloadPreflight {
  readonly eligible: number;
  readonly ineligible: number;
  readonly estimatedFreedBytes: number;
  readonly items: readonly OffloadPreflightItem[];
}

export interface OffloadResultItem {
  readonly photoId: string;
  readonly outcome: 'offloaded' | 'skipped' | 'failed';
  readonly reason: OffloadSkipReason | 'delete-failed' | null;
}

export interface OffloadSummary {
  readonly offloaded: number;
  readonly skipped: number;
  readonly failed: number;
  readonly freedBytes: number;
  readonly results: readonly OffloadResultItem[];
}

export class RehydrateError extends Error {
  override readonly name = 'RehydrateError';
}

export interface OffloadDeps {
  readonly provider: StorageProvider;
  /** Settings/provider-registry truth. The active-provider facade has a
   * fallback target while disconnected, so authState alone is insufficient. */
  readonly providerConnected: () => boolean;
  readonly ledger: SyncLedger;
  readonly repo: {
    readonly get: (id: string) => { contentHash: string; bytes: number; deletedAt: string | null } | undefined;
    /** Live photos (not deleted) sharing this content hash. */
    readonly countByContentHash: (hash: string) => number;
  };
  readonly ledgerDirty: (photoId: string) => boolean;
  readonly blobs: {
    readonly deleteOriginal: (contentHash: string) => Promise<void>;
    readonly hasOriginal: (contentHash: string) => boolean;
    /** Atomic restore of raw ciphertext; must verify before publishing. */
    readonly restoreOriginal: (contentHash: string, ciphertext: Readable, photoId: string) => Promise<void>;
  };
  readonly libraryChanged: (photoIds: readonly string[]) => void;
  readonly audit: (line: string) => void;
}

function blobPath(contentHash: string): string {
  return `blobs/${contentHash.slice(0, 2)}/${contentHash}`;
}

export class OffloadService {
  constructor(private readonly deps: OffloadDeps) {}

  status(photoId: string): SyncStatus | undefined {
    return this.deps.ledger.status(photoId);
  }

  /** Read-only, exact plan used by every confirmation surface. */
  async preflight(photoIds: readonly string[]): Promise<OffloadPreflight> {
    const providerState = await this.providerState();
    const items = [...new Set(photoIds)].map((photoId) => this.classify(photoId, providerState));
    const eligibleItems = items.filter((item) => item.eligible);
    return {
      eligible: eligibleItems.length,
      ineligible: items.length - eligibleItems.length,
      estimatedFreedBytes: eligibleItems.reduce((sum, item) => sum + item.bytes, 0),
      items,
    };
  }

  /** Evicts verified-synced originals; anything else is reported with an
   * exact reason, never silently forced. Thumbs stay browsable offline. */
  async offload(photoIds: readonly string[]): Promise<OffloadSummary> {
    const plan = await this.preflight(photoIds);
    const providerState = await this.providerState();
    let offloaded = 0;
    let skipped = 0;
    let failed = 0;
    let freedBytes = 0;
    const changed: string[] = [];
    const results: OffloadResultItem[] = [];
    for (const planned of plan.items) {
      const photoId = planned.photoId;
      const current = this.classify(photoId, providerState);
      const photo = this.deps.repo.get(photoId);
      if (!current.eligible || photo === undefined) {
        skipped += 1;
        results.push({ photoId, outcome: 'skipped', reason: current.reason ?? 'missing-photo' });
        continue;
      }
      try {
        await this.deps.blobs.deleteOriginal(photo.contentHash);
      } catch (error) {
        failed += 1;
        results.push({ photoId, outcome: 'failed', reason: 'delete-failed' });
        this.deps.audit(`OFFLOAD-FAIL photo=${photoId} stage=delete reason=${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      this.deps.ledger.setStatus(photoId, 'offloaded');
      this.deps.audit(`OFFLOAD photo=${photoId} bytes=${String(photo.bytes)}`);
      offloaded += 1;
      freedBytes += photo.bytes;
      changed.push(photoId);
      results.push({ photoId, outcome: 'offloaded', reason: null });
    }
    if (changed.length > 0) {
      this.deps.libraryChanged(changed);
    }
    return { offloaded, skipped, failed, freedBytes, results };
  }

  private async providerState(): Promise<ProviderAuthState | 'offline'> {
    if (!this.deps.providerConnected()) {
      return 'not-connected';
    }
    try {
      return await this.deps.provider.authState();
    } catch {
      return 'offline';
    }
  }

  private classify(photoId: string, providerState: ProviderAuthState | 'offline'): OffloadPreflightItem {
    const photo = this.deps.repo.get(photoId);
    if (photo === undefined) return { photoId, bytes: 0, eligible: false, reason: 'missing-photo' };
    if (photo.deletedAt !== null) return { photoId, bytes: photo.bytes, eligible: false, reason: 'deleted' };
    const status = this.deps.ledger.status(photoId);
    const statusReason: Partial<Record<SyncStatus, OffloadSkipReason>> = {
      local: 'local',
      syncing: 'syncing',
      offloaded: 'already-offloaded',
      error: 'error',
    };
    const reason = status === undefined ? 'missing-photo' : statusReason[status];
    if (reason !== undefined) return { photoId, bytes: photo.bytes, eligible: false, reason };
    if (this.deps.ledgerDirty(photoId)) return { photoId, bytes: photo.bytes, eligible: false, reason: 'dirty' };
    if (!this.deps.blobs.hasOriginal(photo.contentHash)) {
      return { photoId, bytes: photo.bytes, eligible: false, reason: 'missing-original' };
    }
    if (this.deps.repo.countByContentHash(photo.contentHash) > 1) {
      return { photoId, bytes: photo.bytes, eligible: false, reason: 'shared-original' };
    }
    if (providerState === 'not-connected') {
      return { photoId, bytes: photo.bytes, eligible: false, reason: 'provider-disconnected' };
    }
    if (providerState === 'expired') return { photoId, bytes: photo.bytes, eligible: false, reason: 'provider-expired' };
    if (providerState === 'offline') return { photoId, bytes: photo.bytes, eligible: false, reason: 'provider-offline' };
    return { photoId, bytes: photo.bytes, eligible: true, reason: null };
  }

  /** Download → staged restore → decrypt-and-rehash verify → synced. */
  async rehydrate(photoId: string): Promise<void> {
    const photo = this.deps.repo.get(photoId);
    if (photo === undefined || this.deps.ledger.status(photoId) !== 'offloaded') {
      throw new RehydrateError(`photo ${photoId} is not offloaded`);
    }
    if (!this.deps.blobs.hasOriginal(photo.contentHash)) {
      let ciphertext: Readable;
      try {
        ciphertext = await this.deps.provider.getStream(blobPath(photo.contentHash));
      } catch (error) {
        this.deps.audit(`REHYDRATE-FAIL photo=${photoId} stage=download`);
        throw new RehydrateError(error instanceof ProviderError ? error.message : 'download failed');
      }
      // restoreOriginal verifies (decrypt + re-hash against the content
      // address) BEFORE publishing; a bad download never becomes local
      // truth and the record stays cleanly offloaded.
      await this.deps.blobs.restoreOriginal(photo.contentHash, ciphertext, photoId).catch((error: unknown) => {
        this.deps.audit(`REHYDRATE-FAIL photo=${photoId} stage=verify`);
        throw new RehydrateError(error instanceof Error ? error.message : 'restore failed');
      });
    }
    this.deps.ledger.setStatus(photoId, 'synced');
    this.deps.audit(`REHYDRATE-OK photo=${photoId}`);
    this.deps.libraryChanged([photoId]);
  }
}
