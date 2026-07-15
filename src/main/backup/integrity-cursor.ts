import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

import { queryGet, run } from '../db/sql.js';
import type { BackupIntegrityCursor } from './integrity-scrubber.js';

interface CursorRow {
  readonly version: 1;
  readonly afterPhotoId: string | null;
  readonly completedAt: string | null;
}

/** SQLCipher-backed, provider-scoped resume state for bounded scrub runs. */
export class BackupIntegrityCursorStore {
  constructor(
    private readonly db: BetterSqlite3.Database,
    private readonly providerId: string,
  ) {}

  load(): Promise<BackupIntegrityCursor> {
    const row = queryGet<CursorRow>(
      this.db,
      `SELECT version, after_photo_id AS afterPhotoId, completed_at AS completedAt
         FROM backup_integrity_cursors
        WHERE provider_id = ?`,
      this.providerId,
    );
    return Promise.resolve(
      row === undefined
        ? { version: 1, afterId: null, completedAt: null }
        : { version: row.version, afterId: row.afterPhotoId, completedAt: row.completedAt },
    );
  }

  save(cursor: BackupIntegrityCursor): Promise<void> {
    run(
      this.db,
      `INSERT INTO backup_integrity_cursors (provider_id, version, after_photo_id, completed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider_id) DO UPDATE SET
         version = excluded.version,
         after_photo_id = excluded.after_photo_id,
         completed_at = excluded.completed_at`,
      this.providerId,
      cursor.version,
      cursor.afterId,
      cursor.completedAt,
    );
    return Promise.resolve();
  }
}
