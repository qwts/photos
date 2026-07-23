import { PhotosRepository } from '../db/photos-repository.js';
import type { ImportRuntime } from './import-runtime.js';
import type { LibraryParts } from '../library/library-parts.js';
import { createPosterCaptureRuntime } from './poster-capture-runtime.js';
import type { PosterCaptureService } from './poster-capture-service.js';
import { createRawRepairRuntime } from './raw-repair-runtime.js';
import type { RawRepairService } from './raw-repair-service.js';

// RAW/HEIC preview repair and video poster capture (ADR-0026 §6) are both
// post-import background passes over the same library parts; this keeps their
// wiring out of the app-bootstrap file. Renderer/library side effects are
// injected as callbacks so this module stays free of window/emitter details.
export interface MaintenanceContext {
  readonly parts: LibraryParts;
  readonly runtime: ImportRuntime;
  readonly invalidateThumb: (id: string) => void;
  readonly invalidateFull: (id: string) => void;
  readonly emitChanged: (photoIds: readonly string[]) => void;
  readonly emitPending: (count: number) => void;
  readonly scheduleAutoBackup: () => void;
}

export function buildMaintenanceServices(ctx: MaintenanceContext): { rawRepair: RawRepairService; posterCapture: PosterCaptureService } {
  const { parts, runtime } = ctx;
  const repo = new PhotosRepository(parts.db);
  const shared = {
    blobs: parts.blobStore,
    blobsReady: parts.blobStoreReady,
    thumbnails: runtime.thumbnails,
    currentKey: () => parts.keyStore.currentKey(),
    resolveKey: parts.keyStore.resolver(),
  };
  const rawRepair = createRawRepairRuntime({
    ...shared,
    repo,
    changed: (ids) => {
      for (const id of ids) {
        ctx.invalidateThumb(id);
        ctx.invalidateFull(id);
      }
      ctx.emitChanged(ids);
      ctx.emitPending(repo.stats().pending);
      ctx.scheduleAutoBackup();
    },
  });
  const posterCapture = createPosterCaptureRuntime({
    ...shared,
    db: parts.db,
    changed: (ids) => {
      for (const id of ids) ctx.invalidateThumb(id);
      ctx.emitChanged(ids);
    },
  });
  return { rawRepair, posterCapture };
}
