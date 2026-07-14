import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { ProviderError, type StorageProvider } from './provider.js';
import type { SyncLedger } from './sync-ledger.js';
import { buildBackupManifestV2, type BackupManifestSnapshot } from './backup-manifest.js';

// Backup engine (#105, ADR-0007): dirty photos flow to the provider
// reliably and politely. The ledger's dirty set IS the queue and the resume
// state — a relaunch simply runs again and picks up whatever is still
// dirty. Blobs upload as local ciphertext, byte-for-byte (encrypt-once);
// each batch seals and uploads a manifest generation. Per-item transient
// failures retry with exponential backoff; auth/quota failures stop the run
// (retrying cannot help). Verification tightens the synced bit in #106.

export interface BackupSettings {
  /** 10–100, or null = unlimited (M09's slider). */
  readonly throttlePercent: number | null;
  readonly wifiOnly: boolean;
  readonly autoBackupOnImport: boolean;
}

export type NetworkKind = 'wifi' | 'other' | 'unknown';

export interface BackupItemPhoto {
  readonly id: string;
  readonly contentHash: string;
  readonly bytes: number;
  readonly fileName: string;
  readonly keyId: number;
}

export interface BackupRunResult {
  readonly uploaded: number;
  readonly failed: number;
  /** False when blobs landed but the manifest generation did not — the
   * next run retries it even with nothing dirty (PR #203 review). */
  readonly manifestUploaded: boolean;
  /** 'wifi' when the gate skipped the run entirely. */
  readonly skipped: 'wifi' | null;
}

export interface BackupEngineDeps {
  readonly provider: StorageProvider;
  readonly ledger: SyncLedger;
  readonly dirtyPhotos: () => readonly BackupItemPhoto[];
  /** RAW ciphertext for `contentHash` — uploaded as-is. */
  readonly encryptedStream: (contentHash: string) => Readable;
  /** Seals the manifest JSON (envelope, current key) → ciphertext bytes. */
  readonly sealManifest: (json: string) => Promise<Buffer>;
  /** Seals wrapped key records for fresh-machine recovery under the master. */
  readonly sealRecoveryBootstrap: (generatedAt: string) => Buffer;
  readonly libraryId: () => string;
  /** One consistent DB snapshot: photos, metadata, albums, and membership. */
  readonly manifestSnapshot: () => BackupManifestSnapshot;
  readonly settings: () => BackupSettings;
  readonly network: () => NetworkKind;
  readonly events: {
    progress(done: number, total: number, photoId: string | null): void;
  };
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly pendingCountChanged: (count: number) => void;
  /** Status changes push targeted library updates (tiles re-render). */
  readonly libraryChanged: (photoIds: readonly string[]) => void;
  /** Verify results append to M11's audit trail (#106). */
  readonly audit: (line: string) => void;
}

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 500;
/** Manifest generations retained remotely (ADR-0007). */
const MANIFEST_KEEP = 2;

function blobPath(contentHash: string): string {
  return `blobs/${contentHash.slice(0, 2)}/${contentHash}`;
}

export class BackupEngine {
  private current: Promise<BackupRunResult> | null = null;
  /** A failed manifest upload owes the remote a generation. */
  private manifestOwed = false;

  constructor(private readonly deps: BackupEngineDeps) {}

  /** Single-flight: a trigger during a run joins it (the dirty set is the
   * queue — anything newly dirtied is the NEXT run's work). */
  run(signal?: AbortSignal): Promise<BackupRunResult> {
    this.current ??= this.execute(signal).finally(() => {
      this.current = null;
    });
    return this.current;
  }

  /** The auto-backup-on-import subscription (#105): runs only when M09's
   * setting says so; failures are the run's own to report. */
  maybeAutoRun(): void {
    if (this.deps.settings().autoBackupOnImport) {
      void this.run().catch(() => undefined);
    }
  }

  /** The remote is owed a fresh manifest generation even with nothing
   * dirty (#120): soft-deleting an already-SYNCED photo changes
   * manifestSnapshot() without touching pendingCount, and a restore-from-backup
   * against the stale manifest would resurrect the deleted photo. */
  oweManifest(): void {
    this.manifestOwed = true;
  }

  private async execute(signal?: AbortSignal): Promise<BackupRunResult> {
    const settings = this.deps.settings();
    if (settings.wifiOnly && this.deps.network() === 'other') {
      // The Wi-Fi gate. 'unknown' (platform can't tell) deliberately does
      // NOT block — the unmetered heuristic recorded by ADR-0007/#105.
      return { uploaded: 0, failed: 0, manifestUploaded: true, skipped: 'wifi' };
    }

    // OFFLOADED rows can dirty too (album/favorite edits in the Offloaded
    // view) — their blob is already remote and the machine rightly forbids
    // offloaded → syncing, so they are manifest-only debt: excluded from
    // the upload loop, settled after the manifest generation lands
    // (PR #274 review — before this they crashed the whole run).
    const dirty = this.deps.dirtyPhotos();
    const manifestOnly = dirty.filter((item) => this.deps.ledger.status(item.id) === 'offloaded');
    if (manifestOnly.length > 0) {
      this.manifestOwed = true;
    }
    const items = dirty.filter((item) => this.deps.ledger.status(item.id) !== 'offloaded');
    const total = items.length;
    let uploaded = 0;
    let failed = 0;
    this.deps.events.progress(0, total, null);

    for (const item of items) {
      if (signal?.aborted === true) {
        break; // dirty rows remain dirty — the next run resumes
      }
      const started = this.deps.now();
      try {
        // A row killed mid-upload resumes: it is already 'syncing' and the
        // machine (rightly) rejects syncing → syncing (PR #203 review).
        if (this.deps.ledger.status(item.id) !== 'syncing') {
          this.deps.ledger.setStatus(item.id, 'syncing');
        }
        const remotePath = blobPath(item.contentHash);
        await this.uploadWithRetry(remotePath, () => this.deps.encryptedStream(item.contentHash), signal);
        // Verify-after-upload (#106, ADR-0007): "backed up" is never a lie.
        // The LOCAL ciphertext hash is the truth the remote must match
        // before the row may go synced.
        const local = await this.hashLocalCiphertext(item.contentHash);
        const remote = await this.deps.provider.verify(remotePath);
        if (remote.sha256 !== local.sha256 || remote.bytes !== local.bytes) {
          this.deps.audit(
            `VERIFY-MISMATCH photo=${item.id} local=${local.sha256}/${String(local.bytes)} remote=${remote.sha256}/${String(remote.bytes)}`,
          );
          throw new ProviderError(`verify mismatch for ${item.fileName}`, 'corrupt');
        }
        this.deps.audit(`VERIFY-OK photo=${item.id} sha256=${local.sha256} bytes=${String(local.bytes)}`);
        this.deps.ledger.markBackedUp(item.id, new Date(this.deps.now()).toISOString());
        uploaded += 1;
      } catch (error) {
        failed += 1;
        this.deps.ledger.markError(item.id);
        console.error(`[overlook] backup failed for ${item.fileName}: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof ProviderError && (error.kind === 'auth' || error.kind === 'quota')) {
          this.deps.libraryChanged([item.id]);
          break; // retrying the rest cannot help — surface and stop
        }
      }
      this.deps.events.progress(uploaded + failed, total, item.id);
      this.deps.pendingCountChanged(this.deps.dirtyPhotos().length);
      this.deps.libraryChanged([item.id]);
      await this.throttle(settings, this.deps.now() - started);
    }

    let manifestUploaded = true;
    if (uploaded > 0 || this.manifestOwed) {
      try {
        await this.uploadManifest();
        this.manifestOwed = false;
        // The fresh generation carries the offloaded rows' edits — their
        // dirt settles now, with no status change and no backup stamp.
        if (manifestOnly.length > 0) {
          for (const item of manifestOnly) {
            this.deps.ledger.settleManifestOnly(item.id);
          }
          this.deps.pendingCountChanged(this.deps.dirtyPhotos().length);
          this.deps.libraryChanged(manifestOnly.map((item) => item.id));
        }
      } catch (error) {
        // Blobs landed and their rows are TRUTHFULLY synced — but the
        // remote is owed a manifest generation. The debt survives in this
        // engine and the result says so; the next run (manual or auto)
        // retries even with nothing dirty (PR #203 review).
        this.manifestOwed = true;
        manifestUploaded = false;
        console.error(`[overlook] manifest upload failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { uploaded, failed, manifestUploaded, skipped: null };
  }

  /** Politeness (#105): at p percent, rest (100-p)/p of each item's upload
   * time — 50% alternates work and rest; unlimited never sleeps. */
  private async throttle(settings: BackupSettings, elapsedMs: number): Promise<void> {
    const percent = settings.throttlePercent;
    if (percent === null || percent >= 100 || percent < 10) {
      return;
    }
    await this.deps.sleep(Math.round((elapsedMs * (100 - percent)) / percent));
  }

  private async uploadWithRetry(path: string, open: () => Readable, signal?: AbortSignal): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.deps.provider.put(path, open());
        return;
      } catch (error) {
        const transient = error instanceof ProviderError && error.kind === 'transient';
        if (!transient || attempt >= MAX_ATTEMPTS || signal?.aborted === true) {
          throw error;
        }
        await this.deps.sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
      }
    }
  }

  private async hashLocalCiphertext(contentHash: string): Promise<{ sha256: string; bytes: number }> {
    const hasher = createHash('sha256');
    let bytes = 0;
    const stream = this.deps.encryptedStream(contentHash);
    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    await pipeline(stream, hasher);
    return { sha256: hasher.digest('hex'), bytes };
  }

  /** Seals and uploads the next manifest generation; prunes past N=2. */
  private async uploadManifest(): Promise<void> {
    const generatedAt = new Date(this.deps.now()).toISOString();
    const manifest = buildBackupManifestV2({
      libraryId: this.deps.libraryId(),
      generatedAt,
      snapshot: this.deps.manifestSnapshot(),
    });
    const json = JSON.stringify(manifest);
    const sealed = await this.deps.sealManifest(json);
    // The bootstrap is a superset across rotations and lands first: a crash
    // can leave an old manifest with newer wrapped keys, never a manifest
    // whose envelope key cannot be resolved on a fresh machine.
    const bootstrap = this.deps.sealRecoveryBootstrap(generatedAt);
    await this.putBufferVerified('recovery/bootstrap.ovrb', bootstrap);
    const existing = await this.deps.provider.list('manifest');
    const generation = existing.reduce((max, entry) => {
      const match = /gen-(\d+)\.ovlk$/u.exec(entry.path);
      return match === null ? max : Math.max(max, Number(match[1]));
    }, 0);
    await this.putBufferVerified(`manifest/gen-${String(generation + 1)}.ovlk`, sealed);
    const all = await this.deps.provider.list('manifest');
    const sorted = [...all].sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }));
    for (const stale of sorted.slice(0, Math.max(0, sorted.length - MANIFEST_KEEP))) {
      await this.deps.provider.delete(stale.path);
    }
  }

  private async putBufferVerified(path: string, bytes: Buffer): Promise<void> {
    await this.deps.provider.put(path, Readable.from([bytes]));
    const remote = await this.deps.provider.verify(path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (remote.sha256 !== sha256 || remote.bytes !== bytes.length) {
      throw new ProviderError(`verify mismatch for ${path}`, 'corrupt');
    }
  }
}
