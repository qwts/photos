import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import type { KeyResolver } from '../crypto/envelope.js';
import type { TranscodeResult } from './transcode.js';
import type { PhotoRecord } from '../../shared/library/types.js';

// Export engine (#97): the decrypt counterpart to import — selected photos
// become real files in a chosen folder. Streaming decrypt straight to the
// destination (plaintext only ever exists where the user asked for it),
// original filenames with a recorded numbered suffix on collision, progress
// n/total per file, and cancellation that finishes the file in flight and
// keeps everything completed. v1 decision (recorded on #97): no
// encrypted-export format — the dialog's decrypt-off switch disables Export.

export type ExportFormat = 'original' | 'jpeg';

export interface ExportedFile {
  readonly photoId: string;
  readonly fileName: string;
  /** True when a collision forced a numbered suffix. */
  readonly renamed: boolean;
  /** True when a RAW transcoded from its embedded preview (#98) —
   * resolution honestly capped at preview size. */
  readonly fromPreview: boolean;
}

export interface ExportSummary {
  readonly exported: number;
  readonly failed: number;
  readonly cancelled: number;
  /** How many exports were preview-capped RAW transcodes (#98). */
  readonly previewTranscodes: number;
  readonly files: readonly ExportedFile[];
}

export class ExportPreflightError extends Error {
  override readonly name = 'ExportPreflightError';
}

export interface ExportEngineDeps {
  readonly repo: { readonly get: (id: string) => PhotoRecord | undefined };
  readonly blobs: { readonly getStream: (contentHash: string, resolveKey: KeyResolver, photoId: string) => Readable };
  readonly resolveKey: KeyResolver;
  /** Policy-aware original custody. Production uses this so offloaded
   * originals export from verified temporary ciphertext without becoming
   * durable; legacy/unit seams fall back to blobs.getStream. */
  readonly openOriginal?:
    ((photo: PhotoRecord) => Promise<{ readonly stream: Readable; readonly release?: (() => Promise<void>) | undefined }>) | undefined;
  /** Streams plaintext to `path`; rejects on IO failure (fs seam). */
  readonly writeFile: (path: string, plaintext: Readable) => Promise<void>;
  readonly exists: (path: string) => Promise<boolean>;
  /** Free bytes on the destination volume (statfs seam). */
  readonly freeBytes: (dir: string) => Promise<number>;
  readonly joinPath: (dir: string, name: string) => string;
  /** sharp transcode seam (#98) — src/main/export/transcode.ts in prod. */
  readonly transcodeJpeg: (bytes: Buffer, fileKind: PhotoRecord['fileKind']) => Promise<TranscodeResult>;
  /** Buffers a decrypt stream (transcode needs whole files). */
  readonly bufferStream: (stream: Readable) => Promise<Buffer>;
  readonly events: { progress(done: number, total: number): void };
  /** Protected domains supply a redacted sink; ordinary exports retain the
   * existing filename/error diagnostics. */
  readonly failure?: ((photoId: string, error: unknown) => void) | undefined;
}

/**
 * The default writeFile seam: streams to `path` (never clobbering), and on
 * ANY failure — ENOSPC past the preflight, device errors, an authentication
 * failure mid-decrypt — removes the partial file so the destination never
 * holds a truncated "original" (PR #194 review).
 */
export async function writeFileCleanly(path: string, plaintext: Readable): Promise<void> {
  try {
    await pipeline(plaintext, createWriteStream(path, { flags: 'wx' }));
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
}

/** IMG_4021.RAF + '.jpg' → IMG_4021.jpg */
function reExtension(fileName: string, extension: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? `${fileName}${extension}` : `${fileName.slice(0, dot)}${extension}`;
}

/** IMG_4021.RAF → IMG_4021 (2).RAF */
function withSuffix(fileName: string, counter: number): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? `${fileName} (${String(counter)})` : `${fileName.slice(0, dot)} (${String(counter)})${fileName.slice(dot)}`;
}

export class ExportEngine {
  constructor(private readonly deps: ExportEngineDeps) {}

  async exportPhotos(
    photoIds: readonly string[],
    destination: string,
    signal?: AbortSignal,
    format: ExportFormat = 'original',
  ): Promise<ExportSummary> {
    const photos = photoIds.map((id) => this.deps.repo.get(id));
    // Free-space preflight: the sum of plaintext sizes must fit BEFORE any
    // bytes move — a mid-batch ENOSPC helps nobody.
    const needed = photos.reduce((sum, photo) => sum + (photo?.bytes ?? 0), 0);
    const free = await this.deps.freeBytes(destination);
    if (needed > free) {
      throw new ExportPreflightError(`destination needs ${String(needed)} bytes free, has ${String(free)}`);
    }

    const files: ExportedFile[] = [];
    const total = photoIds.length;
    let done = 0;
    let failed = 0;
    let cancelled = 0;
    for (const [index, id] of photoIds.entries()) {
      if (signal?.aborted === true) {
        // Cancel finishes the file in flight (we only check between files)
        // and keeps everything completed.
        cancelled = total - index;
        break;
      }
      const photo = photos[index];
      let releaseOriginal: (() => Promise<void>) | undefined;
      try {
        if (photo === undefined) {
          throw new Error(`photo ${id} is not in the library`);
        }
        const opened = this.deps.openOriginal === undefined ? null : await this.deps.openOriginal(photo);
        const stream = opened?.stream ?? this.deps.blobs.getStream(photo.contentHash, this.deps.resolveKey, photo.id);
        releaseOriginal = opened?.release;
        let plaintext: Readable = stream;
        let targetName = photo.fileName;
        let fromPreview = false;
        if (format === 'jpeg') {
          const { jpeg, fromPreview: capped } = await this.deps.transcodeJpeg(await this.deps.bufferStream(stream), photo.fileKind);
          plaintext = Readable.from([jpeg]);
          targetName = reExtension(photo.fileName, '.jpg');
          fromPreview = capped;
        }
        const fileName = await this.resolveCollision(destination, targetName);
        await this.deps.writeFile(this.deps.joinPath(destination, fileName), plaintext);
        files.push({ photoId: photo.id, fileName, renamed: fileName !== targetName, fromPreview });
      } catch (error) {
        failed += 1;
        if (this.deps.failure === undefined) {
          console.error(`[overlook] export failed for ${photo?.fileName ?? id}: ${error instanceof Error ? error.message : String(error)}`);
        } else {
          this.deps.failure(id, error);
        }
      } finally {
        await releaseOriginal?.();
      }
      done += 1;
      this.deps.events.progress(done, total);
    }
    return { exported: files.length, failed, cancelled, previewTranscodes: files.filter((file) => file.fromPreview).length, files };
  }

  private async resolveCollision(destination: string, fileName: string): Promise<string> {
    if (!(await this.deps.exists(this.deps.joinPath(destination, fileName)))) {
      return fileName;
    }
    for (let counter = 1; ; counter += 1) {
      const candidate = withSuffix(fileName, counter);
      if (!(await this.deps.exists(this.deps.joinPath(destination, candidate)))) {
        return candidate;
      }
    }
  }
}
