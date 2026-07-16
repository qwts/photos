import { ByteLru } from '../cache/byte-lru.js';
import type { ThumbUrlSize } from '../../shared/library/thumb-url.js';

// Decrypted-thumb delivery core (#75): a byte-capped LRU over a small
// decrypt semaphore, memory-only. The loader is injected (blob store +
// repository wiring lives in main/index.ts), which keeps every policy here
// — eviction, dedup, concurrency, cancellation — unit-testable without
// Electron or crypto. The policy itself lives in ByteLru, shared with the
// full-res delivery service (#91).

export interface LoadedThumb {
  readonly bytes: Buffer;
  /** Original's content hash — content-addressed, so safe as an ETag. */
  readonly contentHash: string;
}

export interface ThumbServiceOptions {
  /** Resolves and decrypts a thumb; null means "no thumb for this photo". */
  readonly loadThumb: (photoId: string, size: ThumbUrlSize) => Promise<LoadedThumb | null>;
  /** Rechecked before and after cache/decrypt work. False revokes both sizes. */
  readonly admit?: ((photoId: string) => boolean) | undefined;
  /** LRU cap over decrypted bytes. Default 32 MiB. */
  readonly maxCacheBytes?: number | undefined;
  /** Concurrent decrypts. Default 4. */
  readonly maxConcurrent?: number | undefined;
}

const DEFAULT_CACHE_BYTES = 32 * 1024 * 1024;
const DEFAULT_CONCURRENT = 4;

export class ThumbService {
  private readonly loadThumb: ThumbServiceOptions['loadThumb'];
  private readonly admit: NonNullable<ThumbServiceOptions['admit']>;
  private readonly lru: ByteLru<LoadedThumb>;

  constructor(options: ThumbServiceOptions) {
    this.loadThumb = options.loadThumb;
    this.admit = options.admit ?? (() => true);
    this.lru = new ByteLru({
      maxCacheBytes: options.maxCacheBytes ?? DEFAULT_CACHE_BYTES,
      maxConcurrent: options.maxConcurrent ?? DEFAULT_CONCURRENT,
    });
  }

  /**
   * Resolves the decrypted thumb, or null when missing or when `signal`
   * aborts before its decrypt slot frees up (scrolled-past requests never
   * spend decrypt work).
   */
  async getThumb(photoId: string, size: ThumbUrlSize, signal?: AbortSignal): Promise<LoadedThumb | null> {
    if (!this.admit(photoId)) {
      this.invalidate(photoId);
      return null;
    }
    const loaded = await this.lru.get(`${photoId} ${size}`, () => this.loadThumb(photoId, size), signal);
    if (!this.admit(photoId)) {
      this.invalidate(photoId);
      return null;
    }
    return loaded;
  }

  invalidate(photoId: string): void {
    this.lru.delete(`${photoId} thumb`);
    this.lru.delete(`${photoId} mid`);
  }

  /** {cachedBytes, peakConcurrent} — observability for tests and M11. */
  stats(): { readonly cachedBytes: number; readonly peakConcurrent: number } {
    return this.lru.stats();
  }

  close(): Promise<void> {
    return this.lru.close();
  }
}
