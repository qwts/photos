import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

import { PhotosRepository } from '../db/photos-repository.js';
import type { AlbumSummary, LibraryStats, PageRequest, PageResult, PhotoRecord, SourceCounts } from '../../shared/library/types.js';

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

  albums(): AlbumSummary[] {
    return this.repo.albums();
  }

  // Albums CRUD (#117): every mutation pushes targeted change events —
  // membership/rename/delete dirty the affected photos (manifest-relevant
  // per ADR-0007), so pendingCount rides along.
  createAlbum(id: string, name: string): AlbumSummary {
    const album = this.repo.createAlbum(id, name);
    this.events.libraryChanged([]);
    return album;
  }

  renameAlbum(albumId: string, name: string): void {
    const members = this.repo.renameAlbum(albumId, name);
    this.events.libraryChanged(members);
    this.events.pendingCountChanged(this.repo.pendingCount());
  }

  deleteAlbum(albumId: string): void {
    const members = this.repo.deleteAlbum(albumId);
    this.events.libraryChanged(members);
    this.events.pendingCountChanged(this.repo.pendingCount());
  }

  addToAlbum(albumId: string, photoIds: readonly string[]): { added: number } {
    const added = this.repo.addToAlbum(albumId, photoIds);
    this.events.libraryChanged(added);
    this.events.pendingCountChanged(this.repo.pendingCount());
    return { added: added.length };
  }

  removeFromAlbum(albumId: string, photoIds: readonly string[]): { removed: number } {
    const removed = this.repo.removeFromAlbum(albumId, photoIds);
    this.events.libraryChanged(removed);
    this.events.pendingCountChanged(this.repo.pendingCount());
    return { removed: removed.length };
  }

  moveBetweenAlbums(sourceAlbumId: string, targetAlbumId: string, photoIds: readonly string[]): { moved: number; alreadyInTarget: number } {
    const result = this.repo.moveBetweenAlbums(sourceAlbumId, targetAlbumId, photoIds);
    this.events.libraryChanged(result.moved);
    this.events.pendingCountChanged(this.repo.pendingCount());
    return { moved: result.moved.length, alreadyInTarget: result.alreadyInTarget };
  }

  // Soft delete + restore (#120): targeted pushes; pendingCount changes in
  // both directions (deleted rows leave it, restores re-dirty).
  deletePhotos(photoIds: readonly string[]): { deleted: number } {
    const deleted = this.repo.softDelete(photoIds);
    this.events.libraryChanged(deleted);
    this.events.pendingCountChanged(this.repo.pendingCount());
    return { deleted: deleted.length };
  }

  restorePhotos(photoIds: readonly string[]): { restored: number } {
    const restored = this.repo.restore(photoIds);
    this.events.libraryChanged(restored);
    this.events.pendingCountChanged(this.repo.pendingCount());
    return { restored: restored.length };
  }

  pendingCount(): number {
    return this.repo.pendingCount();
  }
}
