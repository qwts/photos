import type { Readable } from 'node:stream';

// Storage-provider seam (#103, ADR-0007): the ONE interface both the mock
// and the pCloud adapter (#109) implement. Engine code imports only this —
// the whole epic builds and tests without credentials. Remote paths are
// provider-relative under /Overlook/<library-id>/ (the adapter owns the
// prefix); blobs travel as-is (encrypt-once, ADR-0007).

export type ProviderAuthState = 'connected' | 'not-connected' | 'expired';

export interface RemoteEntry {
  readonly path: string;
  readonly bytes: number;
}

export interface ProviderQuota {
  readonly usedBytes: number;
  readonly totalBytes: number;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    /** Retryable = transient (network, throttle); auth = reconnect needed. */
    readonly kind: 'transient' | 'auth' | 'quota' | 'not-found' | 'corrupt',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface StorageProvider {
  /** Stable id ('mock', 'pcloud') — the registry + settings key. */
  readonly id: string;
  /** Human label for the settings card ("pCloud", "Local mock"). */
  readonly label: string;

  authState(): Promise<ProviderAuthState>;

  /** Uploads `plaintext` (already-encrypted envelope bytes) to `path`,
   * replacing any existing entry. Resolves the provider's recorded size. */
  put(path: string, bytes: Readable): Promise<{ bytes: number }>;

  getStream(path: string): Promise<Readable>;

  /** Entries under `prefix`, non-recursive semantics left to adapters —
   * the engine only lists blob fan-out directories and manifest/. */
  list(prefix: string): Promise<readonly RemoteEntry[]>;

  delete(path: string): Promise<void>;

  quota(): Promise<ProviderQuota>;

  /** Verify-after-upload per ADR-0007: the provider-side checksum (sha256
   * hex) and size for `path`. Adapters without a checksum call MUST
   * implement this by re-download-and-hash — never skip. */
  verify(path: string): Promise<{ sha256: string; bytes: number }>;
}
