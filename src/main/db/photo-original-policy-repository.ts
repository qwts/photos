import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

import { queryGet, run } from './sql.js';

export interface SoftDeleteResult {
  readonly deleted: string[];
  readonly protected: string[];
  readonly missing: string[];
}

export interface OriginalMutationResult {
  readonly changed: string[];
  readonly unchanged: string[];
  readonly missing: string[];
}

export function softDeleteOrdinary(db: BetterSqlite3.Database, photoIds: readonly string[]): SoftDeleteResult {
  return db.transaction(() => {
    const deleted: string[] = [];
    const protectedIds: string[] = [];
    const missing: string[] = [];
    const at = new Date().toISOString();
    for (const photoId of photoIds) {
      const current = queryGet<{ isOriginal: number; deletedAt: string | null }>(
        db,
        `SELECT is_original AS isOriginal, deleted_at AS deletedAt
           FROM ordinary_visible_photos WHERE id = ?`,
        photoId,
      );
      if (current === undefined || current.deletedAt !== null) missing.push(photoId);
      else if (current.isOriginal === 1) protectedIds.push(photoId);
      else {
        const row = queryGet<{ id: string }>(
          db,
          `UPDATE photos SET deleted_at = @at
            WHERE id = @photoId AND deleted_at IS NULL
              AND id IN (SELECT id FROM ordinary_visible_photos)
            RETURNING id`,
          { at, photoId },
        );
        if (row !== undefined) deleted.push(photoId);
      }
    }
    return { deleted, protected: protectedIds, missing };
  })();
}

export function setOriginalClassification(
  db: BetterSqlite3.Database,
  photoIds: readonly string[],
  isOriginal: boolean,
  markDirty: (photoId: string) => void,
): OriginalMutationResult {
  return db.transaction(() => {
    const changed: string[] = [];
    const unchanged: string[] = [];
    const missing: string[] = [];
    for (const photoId of photoIds) {
      const current = queryGet<{ isOriginal: number }>(
        db,
        'SELECT is_original AS isOriginal FROM ordinary_visible_photos WHERE id = ?',
        photoId,
      );
      if (current === undefined) missing.push(photoId);
      else if ((current.isOriginal === 1) === isOriginal) unchanged.push(photoId);
      else {
        run(db, 'UPDATE photos SET is_original = ? WHERE id = ?', isOriginal ? 1 : 0, photoId);
        markDirty(photoId);
        changed.push(photoId);
      }
    }
    return { changed, unchanged, missing };
  })();
}
