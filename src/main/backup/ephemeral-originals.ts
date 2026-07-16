import type { Readable } from 'node:stream';

import { ProviderError, type StorageProvider } from './provider.js';
import type { SyncStatus } from '../../shared/library/types.js';

export type OriginalPurpose = 'view' | 'prefetch' | 'export';
export type OriginalCustody = 'durable' | 'ephemeral';
export type EphemeralStage = 'fetching' | 'verifying' | 'ready' | 'released' | 'error';

export class EphemeralOriginalError extends Error {
  override readonly name = 'EphemeralOriginalError';

  constructor(
    message: string,
    readonly reason: 'not-found' | 'not-offloaded' | 'provider-unavailable' | 'remote-missing' | 'verify-failed' | 'cache-full',
  ) {
    super(message);
  }
}

export interface EphemeralOriginalDeps {
  readonly provider: StorageProvider;
  readonly providerConnected: () => boolean;
  readonly ledger: {
    readonly status: (photoId: string) => SyncStatus | undefined;
    readonly setStatus: (photoId: string, status: SyncStatus) => void;
  };
  readonly repo: {
    readonly get: (photoId: string) => { readonly contentHash: string } | undefined;
  };
  readonly blobs: {
    readonly hasOriginal: (contentHash: string) => boolean;
    readonly durableStream: (contentHash: string, photoId: string) => Readable;
    readonly hasEphemeral: (contentHash: string) => boolean;
    readonly stageEphemeral: (contentHash: string, ciphertext: Readable, photoId: string) => Promise<number>;
    readonly ephemeralStream: (contentHash: string, photoId: string) => Readable;
    readonly promoteEphemeral: (contentHash: string) => Promise<void>;
    readonly deleteEphemeral: (contentHash: string) => Promise<void>;
  };
  readonly reOffloadAfterViewing: () => boolean;
  readonly permanentRestore: (photoId: string) => Promise<void>;
  readonly workChanged: (delta: 1 | -1) => void;
  readonly syncStateChanged: (updates: readonly { readonly id: string; readonly syncState: SyncStatus }[]) => void;
  readonly storageChanged: () => void;
  readonly stateChanged: (state: { readonly photoId: string; readonly stage: EphemeralStage }) => void;
  readonly audit: (line: string) => void;
  readonly maxCacheBytes?: number | undefined;
}

interface CacheEntry {
  readonly bytes: number;
  readonly activePhotoIds: Set<string>;
}

const DEFAULT_CACHE_BYTES = 1024 * 1024 * 1024;

function remotePath(contentHash: string): string {
  return `blobs/${contentHash.slice(0, 2)}/${contentHash}`;
}

/** Verified encrypted process-lifetime custody for cloud-only originals.
 * Durable sync state remains offloaded until keepDownloaded() succeeds. */
export class EphemeralOriginalService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<CacheEntry>>();
  private readonly states = new Map<string, EphemeralStage>();
  private readonly maxCacheBytes: number;
  private cachedBytes = 0;

  constructor(private readonly deps: EphemeralOriginalDeps) {
    this.maxCacheBytes = deps.maxCacheBytes ?? DEFAULT_CACHE_BYTES;
  }

  async open(photoId: string, purpose: OriginalPurpose): Promise<{ readonly stream: Readable; readonly custody: OriginalCustody }> {
    const photo = this.deps.repo.get(photoId);
    if (photo === undefined) throw new EphemeralOriginalError(`photo ${photoId} does not exist`, 'not-found');
    if (this.deps.ledger.status(photoId) !== 'offloaded') {
      if (!this.deps.blobs.hasOriginal(photo.contentHash)) {
        throw new EphemeralOriginalError(`photo ${photoId} has no local original`, 'not-found');
      }
      return { stream: this.deps.blobs.durableStream(photo.contentHash, photoId), custody: 'durable' };
    }
    if (!this.deps.reOffloadAfterViewing()) {
      await this.permanentlyRestore(photoId);
      return { stream: this.deps.blobs.durableStream(photo.contentHash, photoId), custody: 'durable' };
    }

    const entry = await this.ensure(photoId, photo.contentHash);
    if (purpose !== 'prefetch') entry.activePhotoIds.add(photoId);
    this.touch(photo.contentHash, entry);
    return { stream: this.deps.blobs.ephemeralStream(photo.contentHash, photoId), custody: 'ephemeral' };
  }

  async keepDownloaded(photoId: string): Promise<void> {
    const photo = this.deps.repo.get(photoId);
    if (photo === undefined) throw new EphemeralOriginalError(`photo ${photoId} does not exist`, 'not-found');
    if (this.deps.ledger.status(photoId) !== 'offloaded') return;
    if (!this.deps.reOffloadAfterViewing()) {
      await this.permanentlyRestore(photoId);
      return;
    }
    await this.ensure(photoId, photo.contentHash);
    await this.deps.blobs.promoteEphemeral(photo.contentHash);
    this.deps.ledger.setStatus(photoId, 'synced');
    this.deps.syncStateChanged([{ id: photoId, syncState: 'synced' }]);
    this.deps.storageChanged();
    this.deps.audit(`EPHEMERAL-PROMOTE photo=${photoId}`);
    await this.release(photoId);
  }

  status(photoId: string): EphemeralStage | null {
    return this.states.get(photoId) ?? null;
  }

  async release(photoId: string): Promise<void> {
    const photo = this.deps.repo.get(photoId);
    if (photo === undefined) return;
    const entry = this.cache.get(photo.contentHash);
    if (entry === undefined) return;
    entry.activePhotoIds.delete(photoId);
    if (entry.activePhotoIds.size > 0) return;
    await this.remove(photo.contentHash, entry);
    this.changeState(photoId, 'released');
  }

  stats(): { readonly cachedBytes: number; readonly entries: number; readonly inFlight: number } {
    return { cachedBytes: this.cachedBytes, entries: this.cache.size, inFlight: this.inFlight.size };
  }

  private async ensure(photoId: string, contentHash: string): Promise<CacheEntry> {
    const cached = this.cache.get(contentHash);
    if (cached !== undefined && this.deps.blobs.hasEphemeral(contentHash)) return cached;
    if (cached !== undefined) {
      this.cache.delete(contentHash);
      this.cachedBytes -= cached.bytes;
    }
    const pending = this.inFlight.get(contentHash);
    if (pending !== undefined) return pending;
    const promise = this.fetch(photoId, contentHash);
    this.inFlight.set(contentHash, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(contentHash);
    }
  }

  private async fetch(photoId: string, contentHash: string): Promise<CacheEntry> {
    this.deps.workChanged(1);
    this.changeState(photoId, 'fetching');
    let staged = false;
    let published = false;
    try {
      await this.assertProviderAvailable();
      let ciphertext: Readable;
      try {
        ciphertext = await this.deps.provider.getStream(remotePath(contentHash));
      } catch (error) {
        throw new EphemeralOriginalError(
          error instanceof Error ? error.message : 'remote original unavailable',
          error instanceof ProviderError && error.kind === 'not-found' ? 'remote-missing' : 'provider-unavailable',
        );
      }
      this.changeState(photoId, 'verifying');
      let bytes: number;
      try {
        bytes = await this.deps.blobs.stageEphemeral(contentHash, ciphertext, photoId);
        staged = true;
      } catch (error) {
        throw new EphemeralOriginalError(error instanceof Error ? error.message : 'verification failed', 'verify-failed');
      }
      if (bytes > this.maxCacheBytes) {
        await this.deps.blobs.deleteEphemeral(contentHash);
        throw new EphemeralOriginalError('original exceeds the temporary cache limit', 'cache-full');
      }
      await this.makeRoom(bytes);
      const entry = { bytes, activePhotoIds: new Set<string>() };
      this.cache.set(contentHash, entry);
      this.cachedBytes += bytes;
      published = true;
      this.changeState(photoId, 'ready');
      this.deps.audit(`EPHEMERAL-READY photo=${photoId} bytes=${String(bytes)}`);
      return entry;
    } catch (error) {
      if (staged && !published) await this.deps.blobs.deleteEphemeral(contentHash);
      this.changeState(photoId, 'error');
      throw error;
    } finally {
      this.deps.workChanged(-1);
    }
  }

  private async assertProviderAvailable(): Promise<void> {
    if (!this.deps.providerConnected()) throw new EphemeralOriginalError('provider is disconnected', 'provider-unavailable');
    try {
      if ((await this.deps.provider.authState()) !== 'connected') {
        throw new EphemeralOriginalError('provider authentication is unavailable', 'provider-unavailable');
      }
    } catch (error) {
      if (error instanceof EphemeralOriginalError) throw error;
      throw new EphemeralOriginalError('provider is offline', 'provider-unavailable');
    }
  }

  private async permanentlyRestore(photoId: string): Promise<void> {
    this.deps.workChanged(1);
    try {
      await this.deps.permanentRestore(photoId);
    } finally {
      this.deps.workChanged(-1);
    }
  }

  private async makeRoom(incomingBytes: number): Promise<void> {
    for (const [hash, entry] of this.cache) {
      if (this.cachedBytes + incomingBytes <= this.maxCacheBytes) break;
      if (entry.activePhotoIds.size === 0) await this.remove(hash, entry);
    }
    if (this.cachedBytes + incomingBytes > this.maxCacheBytes) {
      throw new EphemeralOriginalError('temporary cache is full with active originals', 'cache-full');
    }
  }

  private touch(contentHash: string, entry: CacheEntry): void {
    this.cache.delete(contentHash);
    this.cache.set(contentHash, entry);
  }

  private async remove(contentHash: string, entry: CacheEntry): Promise<void> {
    this.cache.delete(contentHash);
    this.cachedBytes -= entry.bytes;
    await this.deps.blobs.deleteEphemeral(contentHash);
  }

  private changeState(photoId: string, stage: EphemeralStage): void {
    this.states.set(photoId, stage);
    this.deps.stateChanged({ photoId, stage });
  }
}
