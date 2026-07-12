import type { PhotosRepository } from '../db/photos-repository.js';
import {
  defaultVolumeListerDeps,
  folderSource,
  listVolumes,
  scanSource,
  type ImportSource,
  type SourceScanProgress,
  type SourceScanSummary,
} from './source-scanner.js';

// Import domain service (#84): source discovery + scanning behind the typed
// IPC boundary. The engine (#87) and dialog (#88) build on this.

export interface ImportServiceEvents {
  scanProgress(path: string, progress: SourceScanProgress): void;
}

export class ImportService {
  constructor(
    private readonly repo: PhotosRepository,
    private readonly events: ImportServiceEvents,
  ) {}

  async listSources(): Promise<ImportSource[]> {
    return listVolumes(defaultVolumeListerDeps());
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
}
