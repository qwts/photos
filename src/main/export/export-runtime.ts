import { access, statfs } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import type { KeyResolver } from '../crypto/envelope.js';
import type { ExportFacade } from '../ipc.js';
import { ExportEngine, writeFileCleanly } from './export-engine.js';
import { transcodeToJpeg } from './transcode.js';
import type { PhotoRecord } from '../../shared/library/types.js';

export type DrainableExportFacade = ExportFacade & { drain(): Promise<void> };

export interface ExportRuntimeOptions {
  readonly repo: { readonly get: (id: string) => PhotoRecord | undefined };
  readonly blobs: { readonly getStream: (contentHash: string, resolveKey: KeyResolver, photoId: string) => Readable };
  readonly resolveKey: KeyResolver;
  readonly openOriginal: (photo: PhotoRecord) => Promise<{
    readonly stream: Readable;
    readonly release?: (() => Promise<void>) | undefined;
  }>;
  readonly progress: (done: number, total: number) => void;
  readonly pickDestination: () => Promise<string | null>;
}

export function createExportRuntime(options: ExportRuntimeOptions): DrainableExportFacade {
  const engine = new ExportEngine({
    repo: options.repo,
    blobs: options.blobs,
    resolveKey: options.resolveKey,
    openOriginal: options.openOriginal,
    writeFile: writeFileCleanly,
    exists: async (filePath) =>
      access(filePath).then(
        () => true,
        () => false,
      ),
    freeBytes: async (dir) => {
      const stats = await statfs(dir);
      return stats.bavail * stats.bsize;
    },
    joinPath: (dir, name) => path.join(dir, name),
    transcodeJpeg: transcodeToJpeg,
    bufferStream: async (stream) => buffer(stream),
    events: { progress: options.progress },
  });
  let controller: AbortController | null = null;
  let turn: Promise<unknown> = Promise.resolve();
  return {
    run: (photoIds, destination, format) => {
      const task = async () => {
        controller = new AbortController();
        try {
          const summary = await engine.exportPhotos(photoIds, destination, controller.signal, format);
          return {
            exported: summary.exported,
            failed: summary.failed,
            cancelled: summary.cancelled,
            previewTranscodes: summary.previewTranscodes,
          };
        } finally {
          controller = null;
        }
      };
      const next = turn.then(task, task);
      turn = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    cancel: () => controller?.abort(),
    drain: () =>
      turn.then(
        () => undefined,
        () => undefined,
      ),
    pickDestination: options.pickDestination,
  };
}
