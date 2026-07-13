import { Readable } from 'node:stream';

import { ProviderError, type StorageProvider } from './provider.js';
import type { SyncLedger } from './sync-ledger.js';

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
  /** Manifest row source: every live photo, not just this batch. */
  readonly manifestRows: () => readonly BackupItemPhoto[];
  readonly settings: () => BackupSettings;
  readonly network: () => NetworkKind;
  readonly events: {
    progress(done: number, total: number, photoId: string | null): void;
  };
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly pendingCountChanged: (count: number) => void;
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

  private async execute(signal?: AbortSignal): Promise<BackupRunResult> {
    const settings = this.deps.settings();
    if (settings.wifiOnly && this.deps.network() === 'other') {
      // The Wi-Fi gate. 'unknown' (platform can't tell) deliberately does
      // NOT block — the unmetered heuristic recorded by ADR-0007/#105.
      return { uploaded: 0, failed: 0, manifestUploaded: true, skipped: 'wifi' };
    }

    const items = this.deps.dirtyPhotos();
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
        await this.uploadWithRetry(blobPath(item.contentHash), () => this.deps.encryptedStream(item.contentHash), signal);
        // #106 inserts checksum verification here; until then upload
        // success completes the item.
        this.deps.ledger.markBackedUp(item.id, new Date(this.deps.now()).toISOString());
        uploaded += 1;
      } catch (error) {
        failed += 1;
        this.deps.ledger.markError(item.id);
        console.error(`[overlook] backup failed for ${item.fileName}: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof ProviderError && (error.kind === 'auth' || error.kind === 'quota')) {
          break; // retrying the rest cannot help — surface and stop
        }
      }
      this.deps.events.progress(uploaded + failed, total, item.id);
      this.deps.pendingCountChanged(this.deps.dirtyPhotos().length);
      await this.throttle(settings, this.deps.now() - started);
    }

    let manifestUploaded = true;
    if (uploaded > 0 || this.manifestOwed) {
      try {
        await this.uploadManifest();
        this.manifestOwed = false;
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

  /** Seals and uploads the next manifest generation; prunes past N=2. */
  private async uploadManifest(): Promise<void> {
    const rows = this.deps.manifestRows();
    const json = JSON.stringify({ schema: 1, rows });
    const sealed = await this.deps.sealManifest(json);
    const existing = await this.deps.provider.list('manifest');
    const generation = existing.reduce((max, entry) => {
      const match = /gen-(\d+)\.ovlk$/u.exec(entry.path);
      return match === null ? max : Math.max(max, Number(match[1]));
    }, 0);
    await this.deps.provider.put(`manifest/gen-${String(generation + 1)}.ovlk`, Readable.from([sealed]));
    const all = await this.deps.provider.list('manifest');
    const sorted = [...all].sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }));
    for (const stale of sorted.slice(0, Math.max(0, sorted.length - MANIFEST_KEEP))) {
      await this.deps.provider.delete(stale.path);
    }
  }
}
