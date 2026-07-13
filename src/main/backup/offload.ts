import type { Readable } from 'node:stream';

import { ProviderError, type StorageProvider } from './provider.js';
import type { SyncLedger } from './sync-ledger.js';
import type { SyncStatus } from '../../shared/library/types.js';

// Offload + rehydrate (#107, ADR-0007): originals live only in the cloud,
// safely, and come back when needed. Eligibility trusts the verified bit
// (#106): only synced-and-clean rows evict; thumbnails always stay so the
// library browses offline. Rehydrate is atomic — download, restore staged,
// decrypt-and-rehash verify, only then flip the ledger; any failure leaves
// a clean offloaded record, never a half-restored one.

export interface OffloadSummary {
  readonly offloaded: number;
  readonly skipped: number;
  readonly freedBytes: number;
}

export class RehydrateError extends Error {
  override readonly name = 'RehydrateError';
}

export interface OffloadDeps {
  readonly provider: StorageProvider;
  readonly ledger: SyncLedger;
  readonly repo: {
    readonly get: (id: string) => { contentHash: string; bytes: number } | undefined;
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

  /** Evicts verified-synced originals; anything else is skipped, never
   * forced. Thumbs stay (ADR-0007's browsable-offline stance). */
  async offload(photoIds: readonly string[]): Promise<OffloadSummary> {
    let offloaded = 0;
    let skipped = 0;
    let freedBytes = 0;
    const changed: string[] = [];
    for (const photoId of photoIds) {
      const photo = this.deps.repo.get(photoId);
      const status = this.deps.ledger.status(photoId);
      const eligible = photo !== undefined && status === 'synced' && !this.deps.ledgerDirty(photoId);
      if (!eligible) {
        skipped += 1;
        continue;
      }
      // Content-addressed blobs can back several rows (deleted twins) —
      // evict only when no OTHER live photo still needs the local copy.
      if (this.deps.repo.countByContentHash(photo.contentHash) > 1) {
        skipped += 1;
        continue;
      }
      await this.deps.blobs.deleteOriginal(photo.contentHash);
      this.deps.ledger.setStatus(photoId, 'offloaded');
      this.deps.audit(`OFFLOAD photo=${photoId} bytes=${String(photo.bytes)}`);
      offloaded += 1;
      freedBytes += photo.bytes;
      changed.push(photoId);
    }
    if (changed.length > 0) {
      this.deps.libraryChanged(changed);
    }
    return { offloaded, skipped, freedBytes };
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
