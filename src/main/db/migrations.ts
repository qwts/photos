import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

import { queryAll, run } from './sql.js';

// Forward-only, versioned, transactional migrations per ADR-0005 (#69).
// Broken migrations roll forward with a fix — there are no down migrations.

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: (db: BetterSqlite3.Database) => void;
}

// Migration 001 — ADR-0005 schema v1 (+ the recorded photos.deleted_at
// amendment for the design's Recently-deleted source).
const SCHEMA_V1: Migration = {
  version: 1,
  name: 'schema-v1',
  up: (db) => {
    db.exec(`
      CREATE TABLE keys (
        id INTEGER PRIMARY KEY,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'retired'))
      );

      CREATE TABLE photos (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_kind TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        bytes INTEGER NOT NULL,
        content_hash TEXT NOT NULL UNIQUE,
        camera TEXT,
        lens TEXT,
        iso INTEGER,
        aperture TEXT,
        shutter TEXT,
        focal_length REAL,
        taken_at TEXT,
        gps_lat REAL,
        gps_lon REAL,
        place TEXT,
        imported_at TEXT NOT NULL,
        import_source TEXT NOT NULL,
        favorite INTEGER NOT NULL DEFAULT 0,
        key_id INTEGER NOT NULL REFERENCES keys (id),
        deleted_at TEXT
      );

      -- Keyset-pagination index: sort key is COALESCE(taken_at, imported_at)
      -- so NULL capture dates never break the cursor (ADR-0005 §pagination).
      CREATE INDEX idx_photos_sort ON photos (COALESCE(taken_at, imported_at) DESC, id DESC);
      CREATE INDEX idx_photos_favorite ON photos (favorite) WHERE favorite = 1;
      CREATE INDEX idx_photos_deleted ON photos (deleted_at) WHERE deleted_at IS NOT NULL;

      CREATE TABLE albums (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        position INTEGER NOT NULL
      );

      CREATE TABLE album_photos (
        album_id TEXT NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
        photo_id TEXT NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        PRIMARY KEY (album_id, photo_id)
      );

      CREATE TABLE sync_ledger (
        photo_id TEXT PRIMARY KEY REFERENCES photos (id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('local', 'syncing', 'synced', 'offloaded')),
        last_backup_at TEXT,
        dirty INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX idx_ledger_status ON sync_ledger (status);
    `);
  },
};

export const MIGRATIONS: readonly Migration[] = [SCHEMA_V1];

/** Applies pending migrations in order; each in its own transaction. */
export function migrate(db: BetterSqlite3.Database, migrations: readonly Migration[] = MIGRATIONS): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(queryAll<{ version: number }>(db, 'SELECT version FROM schema_migrations').map((row) => row.version));
  let ran = 0;
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(migration.version)) {
      continue;
    }
    db.transaction(() => {
      migration.up(db);
      run(db, 'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', migration.version, new Date().toISOString());
    })();
    ran += 1;
  }
  return ran;
}
