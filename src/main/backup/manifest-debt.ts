import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

import { queryGet, run } from '../db/sql.js';

// Durable manifest debt (#741). The engine's in-memory `manifestOwed` flag
// did not survive restart, so a run interrupted between "state changed" and
// "generation published" silently forgot that the remote holds a stale
// manifest. One row, library-scoped: any structural change owes the active
// provider a fresh generation until one actually publishes.

export interface ManifestDebtStore {
  readonly load: () => boolean;
  readonly save: (owed: boolean) => void;
}

export function createManifestDebtStore(db: BetterSqlite3.Database, now: () => Date = () => new Date()): ManifestDebtStore {
  return {
    load: () => queryGet<{ owed: number }>(db, 'SELECT owed FROM backup_manifest_debt WHERE id = 1')?.owed === 1,
    save: (owed) => {
      run(
        db,
        `INSERT INTO backup_manifest_debt (id, owed, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET owed = excluded.owed, updated_at = excluded.updated_at`,
        owed ? 1 : 0,
        now().toISOString(),
      );
    },
  };
}
