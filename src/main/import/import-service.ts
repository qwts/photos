import {
  defaultVolumeListerDeps,
  folderSource,
  listVolumes,
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
    // first source — the mock-file-dialog seam the import E2E drives.
    const fixture = process.env['OVERLOOK_IMPORT_SOURCE'];
    if (fixture !== undefined && fixture !== '') {
      return [folderSource(fixture), ...sources];
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
    return this.serialize(async () => {
      const controller = new AbortController();
      this.controller = controller;
      try {
        const { files } = await scanSource(path, { hasContentHash: (hash) => this.repo.hasContentHash(hash) }, () => undefined);
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

  /** Cancel semantics (#88): the engine finishes the file in flight, keeps
   * everything completed, and finalizes the rest as cancelled. */
  cancel(): void {
    this.controller?.abort();
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
