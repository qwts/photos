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
      -- ADR-0005 shape: wrapped key material lives here (wrapped by the
      -- master key, #68); active = retired_at IS NULL.
      CREATE TABLE keys (
        id INTEGER PRIMARY KEY,
        wrapped_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        retired_at TEXT
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

      -- ADR-0005 search: external-content FTS5 over name/place/camera,
      -- trigger-synced from day one (no backfill migration later).
      CREATE VIRTUAL TABLE photos_fts USING fts5(
        file_name, place, camera,
        content='photos', content_rowid='rowid'
      );
      CREATE TRIGGER photos_fts_ai AFTER INSERT ON photos BEGIN
        INSERT INTO photos_fts (rowid, file_name, place, camera)
        VALUES (new.rowid, new.file_name, new.place, new.camera);
      END;
      CREATE TRIGGER photos_fts_ad AFTER DELETE ON photos BEGIN
        INSERT INTO photos_fts (photos_fts, rowid, file_name, place, camera)
        VALUES ('delete', old.rowid, old.file_name, old.place, old.camera);
      END;
      CREATE TRIGGER photos_fts_au AFTER UPDATE ON photos BEGIN
        INSERT INTO photos_fts (photos_fts, rowid, file_name, place, camera)
        VALUES ('delete', old.rowid, old.file_name, old.place, old.camera);
        INSERT INTO photos_fts (rowid, file_name, place, camera)
        VALUES (new.rowid, new.file_name, new.place, new.camera);
      END;
    `);
  },
};

const SCHEMA_V2: Migration = {
  version: 2,
  name: 'sync-ledger-error-status',
  // #104 (ADR-0007): the ledger vocabulary gains 'error' (sync failed, will
  // retry). SQLite cannot alter a CHECK, so the table rebuilds in place —
  // forward-only per the migration policy.
  up(db) {
    db.exec(`
      CREATE TABLE sync_ledger_v2 (
        photo_id TEXT PRIMARY KEY REFERENCES photos (id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('local', 'syncing', 'synced', 'offloaded', 'error')),
        last_backup_at TEXT,
        dirty INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO sync_ledger_v2 (photo_id, status, last_backup_at, dirty)
        SELECT photo_id, status, last_backup_at, dirty FROM sync_ledger;
      DROP TABLE sync_ledger;
      ALTER TABLE sync_ledger_v2 RENAME TO sync_ledger;
      CREATE INDEX idx_ledger_status ON sync_ledger (status);
    `);
  },
};

const SCHEMA_V3: Migration = {
  version: 3,
  name: 'sort-order-indexes',
  // #113 (PR #212 review): Name and Size orderings need their own keyset
  // indexes or a 200K-library sort forces a full scan + temp B-tree before
  // every limited page. Each matches its ORDER BY expression exactly.
  up(db) {
    db.exec(`
      CREATE INDEX idx_photos_name ON photos (lower(file_name), id);
      CREATE INDEX idx_photos_size ON photos (bytes DESC, id DESC);
    `);
  },
};

const SCHEMA_V4: Migration = {
  version: 4,
  name: 'backup-integrity-cursors',
  // #302: each provider resumes its own bounded integrity walk. A library
  // can switch providers, so one global cursor would skip unaudited objects
  // on the newly selected remote.
  up(db) {
    db.exec(`
      CREATE TABLE backup_integrity_cursors (
        provider_id TEXT PRIMARY KEY,
        version INTEGER NOT NULL CHECK (version = 1),
        after_photo_id TEXT,
        completed_at TEXT
      );
    `);
  },
};

const SCHEMA_V5: Migration = {
  version: 5,
  name: 'interop-record-custody',
  // #332: canonical Image Trail records remain first-class interop data.
  // Metadata-only web bookmarks are not fabricated as native camera-photo
  // rows; a local link is populated only when translation creates one.
  up(db) {
    db.exec(`
      CREATE TABLE interop_records (
        interop_id TEXT PRIMARY KEY,
        origin_product TEXT NOT NULL CHECK (origin_product IN ('image-trail', 'overlook')),
        origin_local_id TEXT NOT NULL,
        content_hash TEXT,
        local_photo_id TEXT REFERENCES photos (id) ON DELETE SET NULL,
        review_category TEXT NOT NULL CHECK (
          review_category IN ('eligible', 'duplicate', 'conflict', 'metadata-only', 'unsupported', 'skipped')
        ),
        record_json TEXT NOT NULL CHECK (json_valid(record_json)),
        received_at TEXT NOT NULL,
        UNIQUE (origin_product, origin_local_id)
      );
      CREATE INDEX idx_interop_records_content_hash ON interop_records (content_hash) WHERE content_hash IS NOT NULL;
      CREATE INDEX idx_interop_records_local_photo ON interop_records (local_photo_id) WHERE local_photo_id IS NOT NULL;

      CREATE TABLE interop_albums (
        interop_id TEXT PRIMARY KEY,
        origin_product TEXT NOT NULL CHECK (origin_product IN ('image-trail', 'overlook')),
        origin_local_id TEXT NOT NULL,
        local_album_id TEXT REFERENCES albums (id) ON DELETE SET NULL,
        album_json TEXT NOT NULL CHECK (json_valid(album_json)),
        received_at TEXT NOT NULL,
        UNIQUE (origin_product, origin_local_id)
      );
      CREATE INDEX idx_interop_albums_local_album ON interop_albums (local_album_id) WHERE local_album_id IS NOT NULL;
    `);
  },
};

const SCHEMA_V6: Migration = {
  version: 6,
  name: 'protected-album-custody',
  // #325: this table is deliberately independent of ordinary albums. During
  // #326's re-encryption journal, an ordinary row and a staged protected row
  // can coexist while every public query continues to expose only the former.
  up(db) {
    db.exec(`
      CREATE TABLE protected_album_records (
        album_id TEXT PRIMARY KEY,
        record_version INTEGER NOT NULL CHECK (record_version = 1),
        migration_state TEXT NOT NULL CHECK (migration_state IN ('staged', 'active', 'retiring')),
        credential_generation INTEGER NOT NULL CHECK (credential_generation > 0),
        metadata_generation INTEGER NOT NULL CHECK (metadata_generation > 0),
        credential_record BLOB NOT NULL,
        sealed_metadata BLOB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX idx_protected_album_migration_state ON protected_album_records (migration_state);
    `);
  },
};

const SCHEMA_V7: Migration = {
  version: 7,
  name: 'interop-move-journals',
  // #333: Move is a two-party protocol, not a delete operation. Requests,
  // target receipts, acknowledgements, source finalization, and audit events
  // are durable independently so every crash boundary can be resumed.
  up(db) {
    db.exec(`
      CREATE TABLE interop_move_journals (
        transfer_id TEXT PRIMARY KEY,
        pairing_id TEXT NOT NULL,
        source_product TEXT NOT NULL CHECK (source_product IN ('image-trail', 'overlook')),
        target_product TEXT NOT NULL CHECK (target_product IN ('image-trail', 'overlook')),
        phase TEXT NOT NULL CHECK (phase IN (
          'queued', 'reviewing', 'transferring', 'paused', 'awaiting-acknowledgement',
          'acknowledged', 'finalizing', 'completed', 'cancelled', 'failed'
        )),
        last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (source_product <> target_product)
      ) WITHOUT ROWID;

      CREATE TABLE interop_move_items (
        transfer_id TEXT NOT NULL REFERENCES interop_move_journals (transfer_id) ON DELETE CASCADE,
        interop_id TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        source_local_id TEXT NOT NULL,
        review_category TEXT NOT NULL CHECK (
          review_category IN ('eligible', 'duplicate', 'conflict', 'metadata-only', 'unsupported', 'skipped')
        ),
        record_json TEXT NOT NULL CHECK (json_valid(record_json)),
        state TEXT NOT NULL CHECK (state IN (
          'queued', 'received', 'acknowledged', 'finalizing', 'finalized', 'rejected', 'failed'
        )),
        target_local_id TEXT,
        metadata_persisted INTEGER NOT NULL DEFAULT 0 CHECK (metadata_persisted IN (0, 1)),
        original_verification TEXT NOT NULL DEFAULT 'pending' CHECK (
          original_verification IN ('pending', 'verified', 'metadata-only', 'unavailable')
        ),
        acknowledgement_message_id TEXT,
        acknowledged_message_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(acknowledged_message_ids_json)),
        error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
        received_at TEXT,
        acknowledged_at TEXT,
        finalized_at TEXT,
        PRIMARY KEY (transfer_id, interop_id),
        UNIQUE (transfer_id, source_message_id)
      ) WITHOUT ROWID;
      CREATE INDEX idx_interop_move_items_state ON interop_move_items (transfer_id, state);

      CREATE TABLE interop_move_outbox (
        message_id TEXT PRIMARY KEY,
        transfer_id TEXT NOT NULL REFERENCES interop_move_journals (transfer_id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence >= 0),
        kind TEXT NOT NULL CHECK (kind IN ('record', 'acknowledgement', 'journal', 'error')),
        envelope_json TEXT NOT NULL CHECK (json_valid(envelope_json)),
        created_at TEXT NOT NULL,
        delivered_at TEXT
      ) WITHOUT ROWID;
      CREATE INDEX idx_interop_move_outbox_pending ON interop_move_outbox (transfer_id, sequence)
        WHERE delivered_at IS NULL;

      CREATE TABLE interop_move_receipts (
        pairing_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        transfer_id TEXT NOT NULL REFERENCES interop_move_journals (transfer_id) ON DELETE CASCADE,
        response_message_id TEXT,
        received_at TEXT NOT NULL,
        PRIMARY KEY (pairing_id, message_id)
      ) WITHOUT ROWID;

      CREATE TABLE interop_move_audit (
        event_key TEXT PRIMARY KEY,
        transfer_id TEXT NOT NULL REFERENCES interop_move_journals (transfer_id) ON DELETE CASCADE,
        interop_id TEXT,
        event TEXT NOT NULL CHECK (event IN (
          'queued', 'received', 'acknowledged', 'rejected', 'finalizing', 'finalized', 'failed'
        )),
        details_json TEXT NOT NULL CHECK (json_valid(details_json)),
        created_at TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX idx_interop_move_audit_transfer ON interop_move_audit (transfer_id, created_at, event_key);
    `);
  },
};

export const MIGRATIONS: readonly Migration[] = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7];

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
