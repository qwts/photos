import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

import { PhotosRepository } from '../db/photos-repository.js';
import type { LibraryStats, PageRequest, PageResult, PhotoRecord, SourceCounts } from '../../shared/library/types.js';

// The renderer's typed window into the library (#71) — the contract M04
// builds against. Owns pendingCount (design §backup dirtiness) and emits
// targeted change events instead of refetch-the-world signals.

export interface LibraryEvents {
  libraryChanged(photoIds: readonly string[]): void;
  pendingCountChanged(count: number): void;
}

export class LibraryService {
  private readonly repo: PhotosRepository;

  constructor(
    db: BetterSqlite3.Database,
    private readonly events: LibraryEvents,
  ) {
    this.repo = new PhotosRepository(db);
  }

  page(request: PageRequest): PageResult {
    return this.repo.page(request);
  }

  get(photoId: string): PhotoRecord | undefined {
    return this.repo.get(photoId);
  }

  toggleFavorite(photoId: string): { favorite: boolean; pendingCount: number } {
    const favorite = this.repo.toggleFavorite(photoId);
    const pendingCount = this.repo.pendingCount();
    this.events.libraryChanged([photoId]);
    this.events.pendingCountChanged(pendingCount);
    return { favorite, pendingCount };
  }

  counts(recentSince: string): SourceCounts {
    return this.repo.counts(recentSince);
  }

  stats(): LibraryStats {
    return this.repo.stats();
  }

  pendingCount(): number {
    return this.repo.pendingCount();
  }
}
