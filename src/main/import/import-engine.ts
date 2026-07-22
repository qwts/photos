import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import type { ExtractedMetadata } from './exif.js';
import type { ThumbnailOutcome, ThumbnailRequest } from './thumbnail-service.js';
import type { EnvelopeKey, KeyResolver } from '../crypto/envelope.js';
import { probeMediaInfo, sniffImageKind, sniffVideoKind } from '../../shared/library/media-signatures.js';
import type { MediaInfo } from '../../shared/library/media-info.js';
import type { FileKind, PhotoInsert, PhotoRecord } from '../../shared/library/types.js';

// Import engine (#87): source files → encrypted, verified library records —
// interruptible at any point without loss. The journal (import-journal.ts)
// records every per-file stage transition; a relaunch resumes the batch and
// every stage is safe to redo: content-hash dedupe skips finished files, the
// blob store's no-replace publish tolerates re-stores, and a row committed
// under our own photoId is recognized and carried forward instead of
// re-inserted. Move deletes a source file ONLY after that file's blob
// verifies by full decrypt-and-rehash AND its row is committed — per file,
// never end-of-batch, so a crash mid-import never costs an unverified file.

export type ImportMode = 'copy' | 'move';

/** pending → recorded (blob + row committed) → thumbed → done. Duplicates
 * and failures jump straight to done with their status set. */
export type ImportFileStage = 'pending' | 'recorded' | 'thumbed' | 'done';

export interface ManifestFile {
  readonly path: string;
  readonly fileName: string;
  readonly kind: FileKind;
  stage: ImportFileStage;
  status?: 'imported' | 'duplicate' | 'failed' | 'cancelled' | undefined;
  contentHash?: string | undefined;
  photoId?: string | undefined;
  error?: string | undefined;
  moveLease?: MoveCompensationCandidate | undefined;
}

export interface MoveCompensationCandidate {
  readonly photoId: string;
  readonly contentHash: string;
  readonly sourcePath: string;
  readonly byteCharge: number;
  readonly parentIdentity: string;
}

export interface ImportManifest {
  readonly batchId: string;
  readonly mode: ImportMode;
  readonly source: string;
  /** Private staged cloud source; removed only after the journal clears. */
  readonly cleanupPath?: string | undefined;
  readonly files: ManifestFile[];
}

export interface ImportSummary {
  readonly imported: number;
  /** Imported sources deleted after verified encrypted custody. */
  readonly moved: number;
  /** Sources intentionally left in place (Copy, duplicate, failed, or cancelled). */
  readonly retained: number;
  readonly duplicates: number;
  readonly failed: number;
  /** User-cancelled remainder — never started, sources untouched (#88). */
  readonly cancelled: number;
  readonly photoIds: readonly string[];
  /** Main-process-only inverse custody; IPC response schemas discard it. */
  readonly moveCompensations: readonly MoveCompensationCandidate[];
}

export interface ImportProgressEvents {
  /** Aggregate stream 1 (dialog contract): copy+encrypt+record, n/total. */
  copyProgress(done: number, total: number): void;
  /** Aggregate stream 2: thumbnails, n/total. */
  thumbProgress(done: number, total: number): void;
}

export interface ImportEngineDeps {
  /** Returns an owned plaintext buffer; the engine zeroizes it after use. */
  readonly readFile: (path: string) => Promise<Buffer>;
  readonly deleteFile: (path: string) => Promise<void>;
  readonly readManifest: () => Promise<ImportManifest | null>;
  readonly writeManifest: (manifest: ImportManifest | null) => Promise<void>;
  readonly repo: {
    readonly hasContentHash: (hash: string) => boolean;
    readonly get: (id: string) => PhotoRecord | undefined;
    readonly insert: (photo: PhotoInsert) => void;
    readonly repairGeneratedDimensions: (id: string, width: number, height: number) => boolean;
    readonly setDimensionStatus: (id: string, status: PhotoRecord['dimensionStatus']) => boolean;
    readonly setPreviewFailure: (id: string, failure: PhotoRecord['previewFailure']) => boolean;
  };
  readonly blobs: {
    readonly putOriginal: (
      plaintext: Readable,
      key: EnvelopeKey,
      photoId: string,
    ) => Promise<{ readonly keyId: number; readonly bytes: number }>;
    readonly verifyOriginal: (contentHash: string, resolveKey: KeyResolver, photoId: string) => Promise<boolean>;
  };
  readonly generateThumbs: (request: ThumbnailRequest) => Promise<ThumbnailOutcome>;
  readonly extractMetadata: (bytes: Buffer, kind: FileKind) => Promise<ExtractedMetadata>;
  readonly currentKey: () => EnvelopeKey;
  readonly resolveKey: KeyResolver;
  readonly newId: () => string;
  readonly now: () => string;
  readonly events: ImportProgressEvents;
  readonly cleanupSource?: ((path: string) => Promise<void>) | undefined;
  readonly sourceExists: (path: string) => boolean;
  readonly parentIdentity: (path: string) => Promise<string>;
}

export interface ImportFileInput {
  readonly path: string;
  readonly fileName: string;
  readonly kind: FileKind;
}

export class ImportEngine {
  constructor(private readonly deps: ImportEngineDeps) {}

  /** Resumes a journaled interrupted batch; null when there is none. */
  async resume(signal?: AbortSignal): Promise<ImportSummary | null> {
    const manifest = await this.deps.readManifest();
    if (manifest === null) {
      return null;
    }
    return this.run(manifest, signal);
  }

  async importFiles(
    files: readonly ImportFileInput[],
    mode: ImportMode,
    source: string,
    signal?: AbortSignal,
    cleanupPath?: string,
  ): Promise<ImportSummary> {
    const manifest: ImportManifest = {
      batchId: this.deps.newId(),
      mode,
      source,
      ...(cleanupPath === undefined ? {} : { cleanupPath }),
      files: files.map((file) => ({ ...file, stage: 'pending' as const })),
    };
    await this.deps.writeManifest(manifest);
    return this.run(manifest, signal);
  }

  private async run(manifest: ImportManifest, signal?: AbortSignal): Promise<ImportSummary> {
    const persist = async (): Promise<void> => {
      await this.deps.writeManifest(manifest);
      this.emitProgress(manifest);
    };
    for (const file of manifest.files) {
      if (signal?.aborted === true) {
        // User cancel (#88 semantics): the current file already finished —
        // keep everything completed, finalize the rest as cancelled, and
        // clear the journal below. (A CRASH leaves no abort signal; its
        // journal survives untouched for resume.)
        for (const remaining of manifest.files) {
          if (remaining.stage === 'pending' && remaining.status === undefined) {
            remaining.status = 'cancelled';
            remaining.stage = 'done';
          }
        }
        await persist();
        break;
      }
      if (file.stage === 'done') {
        continue;
      }
      try {
        await this.advance(file, manifest, persist);
      } catch (error) {
        // A per-file failure is recorded and the batch continues; the source
        // file is never deleted on any failed path (cleanup is the LAST
        // stage and only runs after verification).
        file.error = error instanceof Error ? error.message : String(error);
        // Surfaced in the main-process log — the summary only carries counts.
        console.error(`[overlook] import failed for ${file.fileName}: ${file.error}`);
        if (file.status === 'imported') {
          // The row is committed — this photo IS in the library (PR #183
          // review). Keep it imported and leave the stage where it failed:
          // the retained journal retries the remaining stages on resume.
        } else {
          file.status = 'failed';
          file.stage = 'done';
        }
        await persist();
      }
    }
    if (manifest.files.every((file) => file.stage === 'done')) {
      this.emitProgress(manifest);
      await this.deps.writeManifest(null); // batch complete — clear journal
      if (manifest.cleanupPath !== undefined) {
        // Cleanup cannot change a completed import into a failure. A leftover
        // private stage is reaped at the next startup.
        await this.deps.cleanupSource?.(manifest.cleanupPath).catch((error: unknown) => {
          console.error('[overlook] import staging cleanup failed', error);
        });
      }
    }
    const imported = manifest.files.filter((file) => file.status === 'imported').length;
    const moved =
      manifest.mode === 'move' ? manifest.files.filter((file) => file.status === 'imported' && file.stage === 'done').length : 0;
    return {
      imported,
      moved,
      retained: manifest.files.length - moved,
      duplicates: manifest.files.filter((file) => file.status === 'duplicate').length,
      failed: manifest.files.filter((file) => file.status === 'failed').length,
      cancelled: manifest.files.filter((file) => file.status === 'cancelled').length,
      photoIds: manifest.files.flatMap((file) => (file.status === 'imported' && file.photoId !== undefined ? [file.photoId] : [])),
      moveCompensations: manifest.files.flatMap((file) => (file.stage === 'done' && file.moveLease !== undefined ? [file.moveLease] : [])),
    };
  }

  private emitProgress(manifest: ImportManifest): void {
    const total = manifest.files.length;
    const copied = manifest.files.filter((file) => file.stage !== 'pending').length;
    const thumbed = manifest.files.filter((file) => file.stage === 'thumbed' || file.stage === 'done').length;
    this.deps.events.copyProgress(copied, total);
    this.deps.events.thumbProgress(thumbed, total);
  }

  private async advance(file: ManifestFile, manifest: ImportManifest, persist: () => Promise<void>): Promise<void> {
    if (manifest.mode === 'move' && file.stage === 'thumbed' && file.moveLease !== undefined && !this.deps.sourceExists(file.path)) {
      const verified = await this.deps.blobs.verifyOriginal(file.moveLease.contentHash, this.deps.resolveKey, file.moveLease.photoId);
      if (!verified) throw new Error(`blob verification failed for ${file.fileName}; source recovery remains pending`);
      file.stage = 'done';
      await persist();
      return;
    }
    const bytes = await this.deps.readFile(file.path);
    try {
      const contentHash = createHash('sha256').update(bytes).digest('hex');
      file.contentHash = contentHash;
      // Signature-first classification (ADR-0026 §2): the scanner's
      // extension-derived kind is a hint; recognized byte signatures win, so
      // a spoofed suffix records the format the bytes actually are. The name
      // and extension stay untouched (custody, §4). Deterministic from bytes,
      // so resumed batches re-derive the same answer.
      // Video kinds are signature-confirmed too (0x47 TS cadence, #548): a
      // still-image signature wins first, then a container signature, and only
      // then the extension hint — so a valid transport stream classifies as
      // video by content, while a spoofed `.ts` that is really a JPEG records
      // jpeg (ADR-0026 §2).
      const kind = sniffImageKind(bytes) ?? sniffVideoKind(bytes) ?? file.kind;
      const mediaInfo = probeMediaInfo(bytes, kind);

      if (file.stage === 'pending') {
        // A resumed file whose row already committed under OUR photoId (crash
        // in the insert→journal window) is ours to finish, not a duplicate.
        if (file.photoId !== undefined && this.deps.repo.get(file.photoId) !== undefined) {
          file.status = 'imported';
          file.stage = 'recorded';
          await persist();
        } else if (this.deps.repo.hasContentHash(contentHash)) {
          file.status = 'duplicate';
          file.stage = 'done';
          await persist();
          return;
        } else {
          // Journal the id BEFORE the side effects so a resume can recognize
          // its own half-finished work.
          file.photoId ??= this.deps.newId();
          await persist();
          const key = this.deps.currentKey();
          const ref = await this.deps.blobs.putOriginal(Readable.from([bytes]), key, file.photoId);
          const meta = await this.deps.extractMetadata(bytes, kind);
          // Single transaction per file (repo.insert): the row and its dirty
          // sync-ledger entry commit together or not at all — partial records
          // are never visible to queries.
          this.deps.repo.insert(this.toRecord(file, kind, mediaInfo, manifest.source, meta, ref.bytes, ref.keyId));
          file.status = 'imported';
          file.stage = 'recorded';
          await persist();
        }
      }

      if (file.stage === 'recorded') {
        // Idempotent on resume: putThumb's no-replace publish tolerates redone
        // derivatives; a placeholder outcome is an imported photo, not a fail.
        const outcome = await this.deps.generateThumbs({
          photoId: file.photoId ?? '',
          bytes,
          contentHash,
          key: this.deps.currentKey(),
          fileKind: kind,
        });
        if (outcome.width !== null && outcome.height !== null) {
          this.deps.repo.repairGeneratedDimensions(file.photoId ?? '', outcome.width, outcome.height);
        } else {
          this.deps.repo.setDimensionStatus(file.photoId ?? '', 'unavailable');
        }
        if (kind === 'heic' || kind === 'gif' || kind === 'webp') {
          // Formats whose poster comes from decoding the original directly:
          // a placeholder outcome is an imported photo with an honest,
          // actionable display state (ADR-0026 §6), never a failed import.
          this.deps.repo.setPreviewFailure(file.photoId ?? '', outcome.generated ? null : (outcome.failure ?? 'decode-failed'));
        }
        file.stage = 'thumbed';
        await persist();
      }

      if (file.stage === 'thumbed') {
        if (manifest.mode === 'move') {
          // The Move contract (README §5): the source is deleted only after
          // THIS file's blob decrypts and re-hashes clean — never sooner.
          const verified = await this.deps.blobs.verifyOriginal(contentHash, this.deps.resolveKey, file.photoId ?? '');
          if (!verified) {
            throw new Error(`blob verification failed for ${file.fileName}; source retained`);
          }
          file.moveLease = {
            photoId: file.photoId ?? '',
            contentHash,
            sourcePath: file.path,
            byteCharge: bytes.length,
            parentIdentity: await this.deps.parentIdentity(file.path),
          };
          // Persist inverse custody before the cross-filesystem delete. A
          // restart can finish from the verified encrypted original even if
          // the process dies immediately after unlink succeeds.
          await persist();
          await this.deps.deleteFile(file.path);
        }
        file.stage = 'done';
        await persist();
      }
    } finally {
      bytes.fill(0);
    }
  }

  private toRecord(
    file: ManifestFile,
    kind: FileKind,
    mediaInfo: MediaInfo | null,
    source: string,
    meta: ExtractedMetadata,
    bytes: number,
    keyId: number,
  ): PhotoInsert {
    return {
      id: file.photoId ?? '',
      fileName: file.fileName,
      fileKind: kind,
      mediaInfo,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      bytes,
      contentHash: file.contentHash ?? '',
      camera: meta.camera,
      lens: meta.lens,
      iso: meta.iso,
      aperture: meta.aperture,
      shutter: meta.shutter,
      focalLength: meta.focalLength,
      takenAt: meta.takenAt,
      gpsLat: meta.gpsLat,
      gpsLon: meta.gpsLon,
      place: null, // never fabricated — GPS is stored, not geocoded (ADR-0006)
      importedAt: this.deps.now(),
      importSource: source,
      keyId,
    };
  }
}
