import type { Readable } from 'node:stream';

import type { KeyResolver } from '../crypto/envelope.js';
import type { PhotoRecord } from '../../shared/library/types.js';

// Export engine (#97): the decrypt counterpart to import — selected photos
// become real files in a chosen folder. Streaming decrypt straight to the
// destination (plaintext only ever exists where the user asked for it),
// original filenames with a recorded numbered suffix on collision, progress
// n/total per file, and cancellation that finishes the file in flight and
// keeps everything completed. v1 decision (recorded on #97): no
// encrypted-export format — the dialog's decrypt-off switch disables Export.

export interface ExportedFile {
  readonly photoId: string;
  readonly fileName: string;
  /** True when a collision forced a numbered suffix. */
  readonly renamed: boolean;
}

export interface ExportSummary {
  readonly exported: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly files: readonly ExportedFile[];
}

export class ExportPreflightError extends Error {
  override readonly name = 'ExportPreflightError';
}

export interface ExportEngineDeps {
  readonly repo: { readonly get: (id: string) => PhotoRecord | undefined };
  readonly blobs: { readonly getStream: (contentHash: string, resolveKey: KeyResolver, photoId: string) => Readable };
  readonly resolveKey: KeyResolver;
  /** Streams plaintext to `path`; rejects on IO failure (fs seam). */
  readonly writeFile: (path: string, plaintext: Readable) => Promise<void>;
  readonly exists: (path: string) => Promise<boolean>;
  /** Free bytes on the destination volume (statfs seam). */
  readonly freeBytes: (dir: string) => Promise<number>;
  readonly joinPath: (dir: string, name: string) => string;
  readonly events: { progress(done: number, total: number): void };
}

/** IMG_4021.RAF → IMG_4021 (2).RAF */
function withSuffix(fileName: string, counter: number): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? `${fileName} (${String(counter)})` : `${fileName.slice(0, dot)} (${String(counter)})${fileName.slice(dot)}`;
}

export class ExportEngine {
  constructor(private readonly deps: ExportEngineDeps) {}

  async exportPhotos(photoIds: readonly string[], destination: string, signal?: AbortSignal): Promise<ExportSummary> {
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
      try {
        if (photo === undefined) {
          throw new Error(`photo ${id} is not in the library`);
        }
        const fileName = await this.resolveCollision(destination, photo.fileName);
        const stream = this.deps.blobs.getStream(photo.contentHash, this.deps.resolveKey, photo.id);
        await this.deps.writeFile(this.deps.joinPath(destination, fileName), stream);
        files.push({ photoId: photo.id, fileName, renamed: fileName !== photo.fileName });
      } catch (error) {
        failed += 1;
        console.error(`[overlook] export failed for ${photo?.fileName ?? id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      done += 1;
      this.deps.events.progress(done, total);
    }
    return { exported: files.length, failed, cancelled, files };
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
