import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

import { markDirty } from '../backup/sync-ledger.js';
import { queryAll, queryGet, run, runNamed } from './sql.js';

import type {
  AlbumSummary,
  LibraryStats,
  PageCursor,
  PageRequest,
  PageResult,
  PhotoInsert,
  PhotoRecord,
  SourceCounts,
} from '../../shared/library/types.js';

// Typed repository over the photos + sync_ledger tables (#69). No raw SQL
// leaves this module; the IPC service (#71) speaks records only.

interface PhotoRow {
  id: string;
  file_name: string;
  file_kind: string;
  width: number;
  height: number;
  bytes: number;
  content_hash: string;
  camera: string | null;
  lens: string | null;
  iso: number | null;
  aperture: string | null;
  shutter: string | null;
  focal_length: number | null;
  taken_at: string | null;
  gps_lat: number | null;
  gps_lon: number | null;
  place: string | null;
  imported_at: string;
  import_source: string;
  favorite: number;
  key_id: number;
  deleted_at: string | null;
  sync_state: string | null;
  sort_key: string | number;
}

function toRecord(row: PhotoRow): PhotoRecord {
  return {
    id: row.id,
    fileName: row.file_name,
    fileKind: row.file_kind as PhotoRecord['fileKind'],
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    contentHash: row.content_hash,
    camera: row.camera,
    lens: row.lens,
    iso: row.iso,
    aperture: row.aperture,
    shutter: row.shutter,
    focalLength: row.focal_length,
    takenAt: row.taken_at,
    gpsLat: row.gps_lat,
    gpsLon: row.gps_lon,
    place: row.place,
    importedAt: row.imported_at,
    importSource: row.import_source,
    favorite: row.favorite === 1,
    keyId: row.key_id,
    deletedAt: row.deleted_at,
    // New rows always get a ledger row; LEFT JOIN keeps reads total anyway.
    syncState: (row.sync_state ?? 'local') as PhotoRecord['syncState'],
  };
}

// The grid's sort orders (#113). Direction rides along so the keyset cursor
// compares the right way: DESC pages with <, ASC with >.
const ORDERINGS = {
  date: { expr: 'COALESCE(p.taken_at, p.imported_at)', dir: 'DESC', cmp: '<' },
  name: { expr: 'lower(p.file_name)', dir: 'ASC', cmp: '>' },
  size: { expr: 'p.bytes', dir: 'DESC', cmp: '<' },
} as const;

function select(order: keyof typeof ORDERINGS): string {
  return `
  SELECT p.*, l.status AS sync_state, ${ORDERINGS[order].expr} AS sort_key
  FROM photos p
  LEFT JOIN sync_ledger l ON l.photo_id = p.id
`;
}

const SELECT = select('date');

function sourceWhere(source: PageRequest['source']): string {
  switch (source) {
    case 'all':
      return 'p.deleted_at IS NULL';
    case 'favorites':
      return 'p.deleted_at IS NULL AND p.favorite = 1';
    case 'recent':
      return 'p.deleted_at IS NULL AND p.imported_at >= @recentSince';
    case 'offloaded':
      return `p.deleted_at IS NULL AND p.id IN (SELECT photo_id FROM sync_ledger WHERE status = 'offloaded')`;
    case 'deleted':
      return 'p.deleted_at IS NOT NULL';
  }
}

export class PhotosRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  /** Inserts the photo and its sync_ledger row (status local, dirty) atomically. */
  insert(photo: PhotoInsert): void {
    this.db.transaction(() => {
      runNamed(
        this.db,
        `INSERT INTO photos (
           id, file_name, file_kind, width, height, bytes, content_hash,
           camera, lens, iso, aperture, shutter, focal_length, taken_at,
           gps_lat, gps_lon, place, imported_at, import_source, favorite, key_id
         ) VALUES (
           @id, @fileName, @fileKind, @width, @height, @bytes, @contentHash,
           @camera, @lens, @iso, @aperture, @shutter, @focalLength, @takenAt,
           @gpsLat, @gpsLon, @place, @importedAt, @importSource, @favorite, @keyId
         )`,
        { ...photo, favorite: photo.favorite === true ? 1 : 0 },
      );
      run(this.db, `INSERT INTO sync_ledger (photo_id, status, dirty) VALUES (?, 'local', 1)`, photo.id);
    })();
  }

  /** Keyset-paged query per ADR-0005 — never OFFSET. Chips AND-combine; q is
   * a case-insensitive substring over name/place/camera (mock semantics —
   * recorded on #71; the FTS table waits for token search). */
  page(request: PageRequest): PageResult {
    if (request.source === 'recent' && request.recentSince === undefined) {
      throw new Error(`the 'recent' source requires recentSince`);
    }
    const filters: string[] = [];
    if (request.chips?.favorites === true) {
      filters.push('p.favorite = 1');
    }
    if (request.chips?.raw === true) {
      filters.push(`p.file_kind = 'raw'`);
    }
    if (request.chips?.offloaded === true) {
      filters.push(`p.id IN (SELECT photo_id FROM sync_ledger WHERE status = 'offloaded')`);
    }
    if (request.chips?.localOnly === true) {
      filters.push(`p.id IN (SELECT photo_id FROM sync_ledger WHERE status = 'local')`);
    }
    if (request.albumId !== undefined) {
      filters.push('p.id IN (SELECT photo_id FROM album_photos WHERE album_id = @albumId)');
    }
    if (request.query !== undefined && request.query !== '') {
      filters.push(
        `(instr(lower(p.file_name), @query) > 0 OR instr(lower(COALESCE(p.place, '')), @query) > 0 OR instr(lower(COALESCE(p.camera, '')), @query) > 0)`,
      );
    }
    const chipClause = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';
    const ordering = ORDERINGS[request.order ?? 'date'];
    const cursorClause = request.cursor === undefined ? '' : `AND (${ordering.expr}, p.id) ${ordering.cmp} (@cursorKey, @cursorId)`;
    const rows = queryAll<PhotoRow>(
      this.db,
      `${select(request.order ?? 'date')}
       WHERE ${sourceWhere(request.source)} ${chipClause} ${cursorClause}
       ORDER BY sort_key ${ordering.dir}, p.id ${ordering.dir}
       LIMIT @limit`,
      {
        limit: request.limit,
        recentSince: request.recentSince ?? null,
        cursorKey: request.cursor?.sortKey ?? null,
        cursorId: request.cursor?.id ?? null,
        query: request.query?.toLowerCase() ?? null,
        albumId: request.albumId ?? null,
      },
    );
    const last = rows[rows.length - 1];
    const nextCursor: PageCursor | null =
      rows.length === request.limit && last !== undefined ? { sortKey: last.sort_key, id: last.id } : null;
    return { photos: rows.map(toRecord), nextCursor };
  }

  /** Toggles favorite and marks the ledger dirty (feeds pendingCount). */
  toggleFavorite(photoId: string): boolean {
    return this.db.transaction(() => {
      const updated = queryGet<{ favorite: number }>(
        this.db,
        'UPDATE photos SET favorite = 1 - favorite WHERE id = ? RETURNING favorite',
        photoId,
      );
      if (updated === undefined) {
        throw new Error(`photo ${photoId} does not exist`);
      }
      markDirty(this.db, photoId);
      return updated.favorite === 1;
    })();
  }

  get(photoId: string): PhotoRecord | undefined {
    const rows = queryAll<PhotoRow>(this.db, `${SELECT} WHERE p.id = @id LIMIT 1`, { id: photoId });
    const row = rows[0];
    return row === undefined ? undefined : toRecord(row);
  }

  /** Soft delete (#120): rows move to Recently deleted, restorable — no
   * blob, ledger, or membership changes (purge is #121's ceremony).
   * Deleted rows leave pendingCount via the JOIN there. */
  softDelete(photoIds: readonly string[]): string[] {
    return this.db.transaction(() => {
      const deleted: string[] = [];
      const at = new Date().toISOString();
      for (const photoId of photoIds) {
        const row = queryGet<{ id: string }>(
          this.db,
          'UPDATE photos SET deleted_at = @at WHERE id = @photoId AND deleted_at IS NULL RETURNING id',
          { at, photoId },
        );
        if (row !== undefined) {
          deleted.push(photoId);
        }
      }
      return deleted;
    })();
  }

  /** Restore from Recently deleted: favorite/EXIF/ledger status come back
   * untouched; the row re-dirties so the next manifest includes it again. */
  restore(photoIds: readonly string[]): string[] {
    return this.db.transaction(() => {
      const restored: string[] = [];
      for (const photoId of photoIds) {
        const row = queryGet<{ id: string }>(
          this.db,
          'UPDATE photos SET deleted_at = NULL WHERE id = @photoId AND deleted_at IS NOT NULL RETURNING id',
          { photoId },
        );
        if (row !== undefined) {
          markDirty(this.db, photoId);
          restored.push(photoId);
        }
      }
      return restored;
    })();
  }

  /** StatusBar totals: live (non-deleted) photo count + bytes. */
  stats(): LibraryStats {
    const row = queryAll<{ n: number; b: number | null }>(
      this.db,
      'SELECT count(*) AS n, sum(bytes) AS b FROM photos p WHERE p.deleted_at IS NULL',
    )[0];
    const lastBackupAt = queryAll<{ at: string | null }>(this.db, 'SELECT max(last_backup_at) AS at FROM sync_ledger')[0]?.at ?? null;
    const offloadedBytes =
      queryAll<{ b: number | null }>(
        this.db,
        `SELECT sum(p.bytes) AS b FROM photos p JOIN sync_ledger l ON l.photo_id = p.id
          WHERE l.status = 'offloaded' AND p.deleted_at IS NULL`,
      )[0]?.b ?? 0;
    return { photos: row?.n ?? 0, bytes: row?.b ?? 0, pending: this.pendingCount(), lastBackupAt, offloadedBytes };
  }

  /** Dedupe primitive (#84): does this content already live in the library?
   *  Deleted-but-unpurged photos still own their blobs, so no deleted_at
   *  filter — re-importing them is still "not new". */
  hasContentHash(contentHash: string): boolean {
    return queryGet<{ one: number }>(this.db, 'SELECT 1 AS one FROM photos WHERE content_hash = ? LIMIT 1', contentHash) !== undefined;
  }

  /** Sidebar albums list (#80): names + live membership counts. */
  albums(): AlbumSummary[] {
    return queryAll<{ id: string; name: string; n: number }>(
      this.db,
      `SELECT a.id, a.name, count(ap.photo_id) AS n
       FROM albums a LEFT JOIN album_photos ap ON ap.album_id = a.id
       GROUP BY a.id ORDER BY a.position`,
    ).map((row) => ({ id: row.id, name: row.name, count: row.n }));
  }

  /** Album members — the rows an album edit dirties (manifest-relevant
   * per ADR-0007). */
  albumMembers(albumId: string): string[] {
    return queryAll<{ photo_id: string }>(this.db, 'SELECT photo_id FROM album_photos WHERE album_id = @albumId ORDER BY position', {
      albumId,
    }).map((row) => row.photo_id);
  }

  /** Albums CRUD (#117). Deleting an album NEVER deletes photos — the
   * CASCADE clears membership only (Clear-vs-Delete language rules). */
  createAlbum(id: string, name: string): AlbumSummary {
    runNamed(
      this.db,
      `INSERT INTO albums (id, name, created_at, position)
       VALUES (@id, @name, @createdAt, (SELECT COALESCE(max(position) + 1, 0) FROM albums))`,
      { id, name, createdAt: new Date().toISOString() },
    );
    return { id, name, count: 0 };
  }

  /** Renames; returns the members to re-manifest. */
  renameAlbum(albumId: string, name: string): string[] {
    return this.db.transaction(() => {
      const updated = queryGet<{ id: string }>(this.db, 'UPDATE albums SET name = ? WHERE id = ? RETURNING id', name, albumId);
      if (updated === undefined) {
        throw new Error(`album ${albumId} does not exist`);
      }
      const members = this.albumMembers(albumId);
      for (const photoId of members) {
        markDirty(this.db, photoId);
      }
      return members;
    })();
  }

  /** Deletes the album row; membership cascades, photos stay. Returns the
   * (former) members to re-manifest. */
  deleteAlbum(albumId: string): string[] {
    return this.db.transaction(() => {
      const members = this.albumMembers(albumId);
      const deleted = queryGet<{ id: string }>(this.db, 'DELETE FROM albums WHERE id = ? RETURNING id', albumId);
      if (deleted === undefined) {
        throw new Error(`album ${albumId} does not exist`);
      }
      for (const photoId of members) {
        markDirty(this.db, photoId);
      }
      return members;
    })();
  }

  /** Adds photos (idempotent — re-adds are ignored); returns the ids that
   * actually joined, each dirtied for the next manifest. */
  addToAlbum(albumId: string, photoIds: readonly string[]): string[] {
    return this.db.transaction(() => {
      if (queryGet<{ one: number }>(this.db, 'SELECT 1 AS one FROM albums WHERE id = ?', albumId) === undefined) {
        throw new Error(`album ${albumId} does not exist`);
      }
      const added: string[] = [];
      for (const photoId of photoIds) {
        const inserted = queryGet<{ photo_id: string }>(
          this.db,
          `INSERT OR IGNORE INTO album_photos (album_id, photo_id, position)
           VALUES (@albumId, @photoId, (SELECT COALESCE(max(position) + 1, 0) FROM album_photos WHERE album_id = @albumId))
           RETURNING photo_id`,
          { albumId, photoId },
        );
        if (inserted !== undefined) {
          markDirty(this.db, photoId);
          added.push(photoId);
        }
      }
      return added;
    })();
  }

  /** Removes photos from an album (photos stay in the library). */
  removeFromAlbum(albumId: string, photoIds: readonly string[]): string[] {
    return this.db.transaction(() => {
      const removed: string[] = [];
      for (const photoId of photoIds) {
        const gone = queryGet<{ photo_id: string }>(
          this.db,
          'DELETE FROM album_photos WHERE album_id = @albumId AND photo_id = @photoId RETURNING photo_id',
          { albumId, photoId },
        );
        if (gone !== undefined) {
          markDirty(this.db, photoId);
          removed.push(photoId);
        }
      }
      return removed;
    })();
  }

  /** Shared-hash guard for offload (#107): live photos on this hash. */
  countByContentHash(contentHash: string): number {
    return (
      queryAll<{ n: number }>(this.db, 'SELECT count(*) AS n FROM photos WHERE content_hash = @hash AND deleted_at IS NULL', {
        hash: contentHash,
      })[0]?.n ?? 0
    );
  }

  /** Manifest rows (#105, ADR-0007): EVERY live photo — the remote must be
   * re-importable without a local DB, not just describe the last batch. */
  manifestRows(): readonly { id: string; contentHash: string; bytes: number; fileName: string; keyId: number }[] {
    return queryAll<{ id: string; contentHash: string; bytes: number; fileName: string; keyId: number }>(
      this.db,
      `SELECT p.id, p.content_hash AS contentHash, p.bytes, p.file_name AS fileName, p.key_id AS keyId
         FROM photos p WHERE p.deleted_at IS NULL ORDER BY p.imported_at, p.id`,
    );
  }

  /** The backup queue's input (#105): dirty, not-deleted photos. */
  dirtyPhotos(): readonly { id: string; contentHash: string; bytes: number; fileName: string; keyId: number }[] {
    return queryAll<{ id: string; contentHash: string; bytes: number; fileName: string; keyId: number }>(
      this.db,
      `SELECT p.id, p.content_hash AS contentHash, p.bytes, p.file_name AS fileName, p.key_id AS keyId
         FROM photos p JOIN sync_ledger l ON l.photo_id = p.id
        WHERE l.dirty = 1 AND p.deleted_at IS NULL
        ORDER BY p.imported_at, p.id`,
    );
  }

  /** pendingCount source: dirty ledger rows (design §backup dirtiness). */
  pendingCount(): number {
    // Deleted rows leave the pending count (#120): they neither upload
    // (dirtyPhotos filters them) nor belong in "ENCRYPTING N → PCLOUD".
    return (
      queryAll<{ n: number }>(
        this.db,
        'SELECT count(*) AS n FROM sync_ledger l JOIN photos p ON p.id = l.photo_id WHERE l.dirty = 1 AND p.deleted_at IS NULL',
      )[0]?.n ?? 0
    );
  }

  /** Sidebar counts share page()'s sourceWhere — ONE query truth per
   * source, so counts and grid results cannot drift (#119; the mock's
   * fall-through gap, fixed by construction). */
  counts(recentSince: string): SourceCounts {
    const one = (source: PageRequest['source']): number =>
      queryAll<{ n: number }>(this.db, `SELECT count(*) AS n FROM photos p WHERE ${sourceWhere(source)}`, {
        recentSince,
      })[0]?.n ?? 0;
    return {
      all: one('all'),
      favorites: one('favorites'),
      recent: one('recent'),
      offloaded: one('offloaded'),
      deleted: one('deleted'),
    };
  }
}
