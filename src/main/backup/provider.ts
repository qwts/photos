import type { Readable } from 'node:stream';
import type { ProviderCapabilities, ProviderId } from '../../shared/backup/provider-descriptor.js';

// Storage-provider seam (#103, ADR-0007): the ONE interface both the mock
// and every cloud adapter implement. Engine code imports only this —
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
  /** Null when the provider reports usage but no finite account limit. */
  readonly totalBytes: number | null;
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

/** Remote paths are OUR vocabulary: forward-slash relative segments only.
 * Backslashes and drive letters would re-split under Windows node:path
 * (PR #200 review), so they are rejected outright, as are traversal and
 * empty segments. Every adapter validates through this one gate (#255). */
export function assertSafeRemotePath(path: string): void {
  const segments = path.split('/');
  if (
    path === '' ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes(':') ||
    segments.some((segment) => segment === '' || segment === '..')
  ) {
    throw new ProviderError(`unsafe remote path: ${path}`, 'corrupt');
  }
}

export interface StorageProvider {
  /** Stable id ('mock', 'pcloud', 'google-drive') — registry + settings key. */
  readonly id: ProviderId;
  /** Human label for settings and restore surfaces. */
  readonly label: string;
  /** UI and policy truth; adapters state limits explicitly. */
  readonly capabilities: ProviderCapabilities;

  /** Enumerates provider-owned Overlook library homes. */
  listLibraries(): Promise<readonly string[]>;

  /** Returns the same provider authority scoped to one discovered library. */
  forLibrary(libraryId: string): StorageProvider;

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
