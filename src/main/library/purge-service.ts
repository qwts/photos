import { ProviderError, type StorageProvider } from '../backup/provider.js';
import type { PhotoRecord } from '../../shared/library/types.js';

// Permanent purge (#121): the one truly destructive path, done with
// ceremony. Repair-friendly order per the issue: DB row FIRST (nothing ever
// points at missing data), local blobs second, remote last — a crash or a
// failed remote delete leaves orphaned copies (repairable, M11 audits find
// them via the ORPHAN-REMOTE audit line), never a row that lies about
// having data. Retention: soft-deleted rows auto-purge after 30 days — a
// fixed constant until a settings control is designed (recorded).

export const PURGE_RETENTION_DAYS = 30;

const REMOTE_ATTEMPTS = 3;
const REMOTE_BACKOFF_MS = 500;

export interface PurgeSummary {
  readonly purged: number;
  readonly skipped: number;
  /** Remote copies left behind (audited) — retried on later purges never
   * silently forgotten. */
  readonly remoteFailures: number;
}

export interface PurgeDeps {
  readonly repo: {
    readonly getDeleted: (photoId: string) => PhotoRecord | undefined;
    readonly purgeRow: (photoId: string) => void;
    readonly countAnyByContentHash: (hash: string) => number;
    readonly expiredDeleted: (cutoffIso: string) => string[];
  };
  readonly blobs: {
    readonly deleteOriginal: (contentHash: string) => Promise<void>;
    readonly deleteThumbs: (contentHash: string) => Promise<void>;
  };
  readonly provider: StorageProvider;
  readonly connected: () => boolean;
  /** Purging changes manifestRows() — the remote is owed a generation. */
  readonly oweManifest: () => void;
  readonly libraryChanged: (photoIds: readonly string[]) => void;
  readonly audit: (line: string) => void;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

function blobPath(contentHash: string): string {
  return `blobs/${contentHash.slice(0, 2)}/${contentHash}`;
}

export class PurgeService {
  constructor(private readonly deps: PurgeDeps) {}

  /** Purges soft-deleted rows: DB row → local blobs → remote (retried).
   * Live rows are skipped, never forced. */
  async purge(photoIds: readonly string[]): Promise<PurgeSummary> {
    let purged = 0;
    let skipped = 0;
    let remoteFailures = 0;
    const changed: string[] = [];
    for (const photoId of photoIds) {
      const photo = this.deps.repo.getDeleted(photoId);
      if (photo === undefined) {
        skipped += 1;
        continue;
      }
      this.deps.repo.purgeRow(photoId);
      // Content-addressed blobs may back other rows (deleted twins count —
      // they still own their bytes until their own purge).
      if (this.deps.repo.countAnyByContentHash(photo.contentHash) === 0) {
        await this.deps.blobs.deleteOriginal(photo.contentHash);
        await this.deps.blobs.deleteThumbs(photo.contentHash);
        remoteFailures += await this.deleteRemote(photoId, photo.contentHash);
      }
      this.deps.audit(`PURGE photo=${photoId} bytes=${String(photo.bytes)}`);
      purged += 1;
      changed.push(photoId);
    }
    if (changed.length > 0) {
      // The purged rows left manifestRows() with nothing dirty — the host
      // owes (and quietly pushes) a fresh generation, like soft delete.
      this.deps.oweManifest();
      this.deps.libraryChanged(changed);
    }
    return { purged, skipped, remoteFailures };
  }

  /** The retention sweep (#121): everything older than the window goes. */
  async purgeExpired(): Promise<PurgeSummary> {
    const cutoff = new Date(this.deps.now() - PURGE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const expired = this.deps.repo.expiredDeleted(cutoff);
    if (expired.length === 0) {
      return { purged: 0, skipped: 0, remoteFailures: 0 };
    }
    this.deps.audit(`PURGE-RETENTION count=${String(expired.length)} cutoff=${cutoff}`);
    return this.purge(expired);
  }

  /** Remote last, tolerated: 'not-found' is success (already gone),
   * transient errors retry with backoff, a final failure is audited as an
   * orphan for M11's audits — the local state never lies either way. */
  private async deleteRemote(photoId: string, contentHash: string): Promise<0 | 1> {
    if (!this.deps.connected()) {
      this.deps.audit(`ORPHAN-REMOTE photo=${photoId} hash=${contentHash} reason=disconnected`);
      return 1;
    }
    for (let attempt = 1; attempt <= REMOTE_ATTEMPTS; attempt += 1) {
      try {
        await this.deps.provider.delete(blobPath(contentHash));
        return 0;
      } catch (error) {
        if (error instanceof ProviderError && error.kind === 'not-found') {
          return 0;
        }
        if (attempt === REMOTE_ATTEMPTS) {
          const reason = error instanceof Error ? error.message : 'unknown';
          this.deps.audit(`ORPHAN-REMOTE photo=${photoId} hash=${contentHash} reason=${reason}`);
          return 1;
        }
        await this.deps.sleep(REMOTE_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
    return 1;
  }
}
