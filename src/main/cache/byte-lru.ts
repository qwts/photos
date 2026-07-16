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
  private readonly inFlight = new Map<string, { readonly promise: Promise<V | null>; readonly signals: (AbortSignal | undefined)[] }>();
  private readonly generations = new Map<string, number>();
  private active = 0;
  private peak = 0;
  private readonly queue: (() => void)[] = [];
  private closed = false;

  constructor(options: ByteLruOptions) {
    this.maxCacheBytes = options.maxCacheBytes;
    this.maxConcurrent = options.maxConcurrent;
  }

  /**
   * Resolves the cached value, joining an identical in-flight load when one
   * exists, otherwise loading under the concurrency cap. Returns null when
   * the loader does (never cached — absence must stay observable) or when
   * EVERY request joined to the load has aborted before it starts — one
   * still-interested waiter keeps a queued load alive (rapid prev/next can
   * land back on an id whose first requester already paged away).
   */
  async get(key: string, load: () => Promise<V | null>, signal?: AbortSignal): Promise<V | null> {
    if (this.closed) return null;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      // Refresh recency.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const pending = this.inFlight.get(key);
    if (pending !== undefined) {
      pending.signals.push(signal);
      return pending.promise;
    }
    const signals: (AbortSignal | undefined)[] = [signal];
    const generation = this.generations.get(key) ?? 0;
    const promise = this.runJob(key, load, signals, generation);
    const entry = { promise, signals };
    this.inFlight.set(key, entry);
    try {
      return await promise;
    } finally {
      if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
    }
  }

  /** True when `key` would resolve without loading (cached or in flight). */
  isWarm(key: string): boolean {
    return this.cache.has(key) || this.inFlight.has(key);
  }

  /** Revokes a completed value and any in-flight generation. Plaintext from
   * either generation is zeroized and cannot settle an existing or later
   * request after external custody closes. */
  delete(key: string): void {
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    this.inFlight.delete(key);
    const value = this.cache.get(key);
    if (value === undefined) return;
    this.cache.delete(key);
    this.cacheBytes -= value.bytes.length;
    value.bytes.fill(0);
  }

  /** {cachedBytes, peakConcurrent} — observability for tests and M11. */
  stats(): { readonly cachedBytes: number; readonly peakConcurrent: number } {
    return { cachedBytes: this.cacheBytes, peakConcurrent: this.peak };
  }

  /** Stops admission, drains already-started loads, and zeroizes every
   * plaintext buffer held by the cache or returned from an in-flight load. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const pending = [...this.inFlight.entries()];
    for (const [key] of pending) this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    const settled = await Promise.allSettled(pending.map(([, entry]) => entry.promise));
    for (const result of settled) {
      if (result.status === 'fulfilled') result.value?.bytes.fill(0);
    }
    for (const value of this.cache.values()) value.bytes.fill(0);
    this.cache.clear();
    this.cacheBytes = 0;
  }

  private async runJob(
    key: string,
    load: () => Promise<V | null>,
    signals: readonly (AbortSignal | undefined)[],
    generation: number,
  ): Promise<V | null> {
    await this.acquire();
    try {
      // close() may have started while this job waited behind the decrypt
      // semaphore. Never begin new plaintext work after custody is sealing.
      if (this.closed) return null;
      // A waiter with no signal never aborts, so it keeps the load alive.
      if (signals.every((signal) => signal?.aborted === true)) {
        return null;
      }
      const value = await load();
      if (value !== null) {
        if (this.closed || (this.generations.get(key) ?? 0) !== generation) {
          value.bytes.fill(0);
          return null;
        }
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
