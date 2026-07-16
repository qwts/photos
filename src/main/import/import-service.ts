import {
  defaultVolumeListerDeps,
  folderSource,
  listVolumes,
  scanFiles,
  scanSource,
  type ImportSource,
  type SourceScanProgress,
  type SourceScanSummary,
} from './source-scanner.js';
import type { ImportEngine, ImportMode, ImportSummary } from './import-engine.js';
import type { PhotosRepository } from '../db/photos-repository.js';

// Import domain service (#84/#87): source discovery, scanning, and batch
// runs behind the typed IPC boundary. The engine owns crash-safety; this
// layer owns "which files" (a fresh scan's NEW files) and event fan-out.

export interface ImportServiceEvents {
  scanProgress(path: string, progress: SourceScanProgress): void;
  copyProgress(done: number, total: number): void;
  thumbProgress(done: number, total: number): void;
  /** Batch landed: ids for the library:changed push + pending recount. */
  imported(photoIds: readonly string[]): void;
}

export class ImportService {
  /** One journal, one writer: batches and resumes run strictly in turn —
   * overlapping runs would overwrite or clear each other's resume state
   * (PR #183 review). */
  private turn: Promise<unknown> = Promise.resolve();
  private controller: AbortController | null = null;

  constructor(
    private readonly repo: PhotosRepository,
    private readonly events: ImportServiceEvents,
    private readonly engine: ImportEngine,
    // Test/dev fixture source (#90 → #129 F1): the composition root supplies
    // this ONLY in unpackaged builds (gated via harnessEnv). A packaged app
    // gets no injector, so the fixture folder can never be surfaced by env.
    private readonly fixtureSource: () => string | undefined = () => undefined,
  ) {}

  private async serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.turn.then(task, task);
    this.turn = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async listSources(): Promise<ImportSource[]> {
    const sources = await listVolumes(defaultVolumeListerDeps());
    // Harness hook (#90, OVERLOOK_* family): surface a fixture folder as the
    // first source — the mock-file-dialog seam the import E2E drives. The
    // injector is unpackaged-only (#129 F1); it returns undefined otherwise.
    const fixture = this.fixtureSource();
    if (fixture !== undefined && fixture !== '') {
      // The fixture stands in for the mounted card, so it poses as a volume
      // — the dialog's SD segment surfaces it and Move stays testable (#237).
      return [{ ...folderSource(fixture), kind: 'volume' }, ...sources];
    }
    return sources;
  }

  /** The manual choose-folder path shares the source shape. */
  sourceForFolder(path: string): ImportSource {
    return folderSource(path);
  }

  async scanSource(path: string): Promise<SourceScanSummary> {
    const { summary } = await scanSource(path, { hasContentHash: (hash) => this.repo.hasContentHash(hash) }, (progress) => {
      this.events.scanProgress(path, progress);
    });
    return summary;
  }

  /** Runs a batch over the source's NEW files (fresh scan → engine). */
  async run(path: string, mode: ImportMode): Promise<ImportSummary> {
    if (mode === 'move') {
      // Pipeline-layer enforcement (#237): Move deletes sources after
      // verification, so it is only ever offered for removable volumes —
      // a folder or dropped import must never delete a user's own files,
      // even if a caller bypasses the dialog's forced-Copy UI.
      const sources = await this.listSources();
      if (!sources.some((candidate) => candidate.kind === 'volume' && candidate.path === path)) {
        throw new Error('Move is only available for removable volumes');
      }
    }
    return this.serialize(async () => {
      const controller = new AbortController();
      this.controller = controller;
      try {
        // The signal reaches the fresh scan too — Cancel during hashing on a
        // big card must stop the I/O promptly (PR #186 review); the engine
        // then finalizes whatever the truncated scan surfaced as cancelled.
        const { files } = await scanSource(
          path,
          { hasContentHash: (hash) => this.repo.hasContentHash(hash) },
          () => undefined,
          controller.signal,
        );
        const fresh = files.filter((file) => file.isNew).map(({ path: filePath, fileName, kind }) => ({ path: filePath, fileName, kind }));
        const summary = await this.engine.importFiles(fresh, mode, path, controller.signal);
        if (summary.photoIds.length > 0) {
          this.events.imported(summary.photoIds);
        }
        return summary;
      } finally {
        this.controller = null;
      }
    });
  }

  /** Dropped-file batch (#237): explicit paths, always copy — the window
   * drop can never delete a user's own files. */
  async runFiles(paths: readonly string[]): Promise<ImportSummary> {
    return this.serialize(async () => {
      const controller = new AbortController();
      this.controller = controller;
      try {
        const { files } = await scanFiles(
          paths,
          { hasContentHash: (hash) => this.repo.hasContentHash(hash) },
          () => undefined,
          controller.signal,
        );
        const fresh = files.filter((file) => file.isNew).map(({ path: filePath, fileName, kind }) => ({ path: filePath, fileName, kind }));
        const summary = await this.engine.importFiles(fresh, 'copy', 'dropped', controller.signal);
        if (summary.photoIds.length > 0) {
          this.events.imported(summary.photoIds);
        }
        return summary;
      } finally {
        this.controller = null;
      }
    });
  }

  /** Dropped-file scan (#237): the dialog's Dropped card numbers. */
  async scanDropped(paths: readonly string[]): Promise<SourceScanSummary> {
    const { summary } = await scanFiles(paths, { hasContentHash: (hash) => this.repo.hasContentHash(hash) });
    return summary;
  }

  /** Cancel semantics (#88): the engine finishes the file in flight, keeps
   * everything completed, and finalizes the rest as cancelled. */
  cancel(): void {
    this.controller?.abort();
  }

  /** Waits for the serialized import/resume queue to stop touching library
   * state. Lock teardown calls cancel() first, then drains before closing DB
   * and key custody. */
  drain(): Promise<void> {
    return this.turn.then(
      () => undefined,
      () => undefined,
    );
  }

  /** Completes a journaled batch an earlier run left behind (crash-safety:
   * called once at service bootstrap). */
  async resume(): Promise<ImportSummary | null> {
    return this.serialize(async () => {
      const summary = await this.engine.resume();
      if (summary !== null && summary.photoIds.length > 0) {
        this.events.imported(summary.photoIds);
      }
      return summary;
    });
  }
}
