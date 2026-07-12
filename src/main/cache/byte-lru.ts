// Byte-capped LRU over an async loader (#75, generalized for #91): the
// caching/dedup/concurrency policy the decrypting delivery services share.
// Values live in memory only; eviction is by total plaintext bytes, recency
// refreshes on hit, identical in-flight loads are shared, and a request whose
// signal aborts before a decrypt slot frees up never spends decrypt work.

export interface ByteSized {
  readonly bytes: Buffer;
}

export interface ByteLruOptions {
  /** LRU cap over cached bytes. */
  readonly maxCacheBytes: number;
  /** Concurrent loads (decrypts are CPU + IO — keep this small). */
  readonly maxConcurrent: number;
}

export class ByteLru<V extends ByteSized> {
  private readonly maxCacheBytes: number;
  private readonly maxConcurrent: number;

  /** Insertion order doubles as recency order (Map preserves it). */
  private readonly cache = new Map<string, V>();
  private cacheBytes = 0;
  private readonly inFlight = new Map<string, Promise<V | null>>();
  private active = 0;
  private peak = 0;
  private readonly queue: (() => void)[] = [];

  constructor(options: ByteLruOptions) {
    this.maxCacheBytes = options.maxCacheBytes;
    this.maxConcurrent = options.maxConcurrent;
  }

  /**
   * Resolves the cached value, joining an identical in-flight load when one
   * exists, otherwise loading under the concurrency cap. Returns null when
   * the loader does (never cached — absence must stay observable) or when
   * `signal` aborts before the load starts.
   */
  async get(key: string, load: () => Promise<V | null>, signal?: AbortSignal): Promise<V | null> {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      // Refresh recency.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const pending = this.inFlight.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const job = this.runJob(key, load, signal);
    this.inFlight.set(key, job);
    try {
      return await job;
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** True when `key` would resolve without loading (cached or in flight). */
  isWarm(key: string): boolean {
    return this.cache.has(key) || this.inFlight.has(key);
  }

  /** {cachedBytes, peakConcurrent} — observability for tests and M11. */
  stats(): { readonly cachedBytes: number; readonly peakConcurrent: number } {
    return { cachedBytes: this.cacheBytes, peakConcurrent: this.peak };
  }

  private async runJob(key: string, load: () => Promise<V | null>, signal?: AbortSignal): Promise<V | null> {
    await this.acquire();
    try {
      if (signal?.aborted === true) {
        return null;
      }
      const value = await load();
      if (value !== null) {
        this.store(key, value);
      }
      return value;
    } finally {
      this.release();
    }
  }

  private store(key: string, value: V): void {
    if (value.bytes.length > this.maxCacheBytes) {
      return; // Larger than the whole cache — serve without caching.
    }
    this.cache.set(key, value);
    this.cacheBytes += value.bytes.length;
    for (const [oldestKey, oldest] of this.cache) {
      if (this.cacheBytes <= this.maxCacheBytes) {
        break;
      }
      this.cache.delete(oldestKey);
      this.cacheBytes -= oldest.bytes.length;
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      this.peak = Math.max(this.peak, this.active);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        this.peak = Math.max(this.peak, this.active);
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next !== undefined) {
      next();
    }
  }
}
