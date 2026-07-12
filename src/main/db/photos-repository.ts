import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

import { queryAll, queryGet, run, runNamed } from './sql.js';

import type { PageCursor, PageRequest, PageResult, PhotoInsert, PhotoRecord, SourceCounts } from '../../shared/library/types.js';

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
  sort_key: string;
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
  };
}

const SELECT = `
  SELECT p.*, COALESCE(p.taken_at, p.imported_at) AS sort_key
  FROM photos p
`;

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

  /** Keyset-paged query per ADR-0005 — never OFFSET. */
  page(request: PageRequest): PageResult {
    if (request.source === 'recent' && request.recentSince === undefined) {
      throw new Error(`the 'recent' source requires recentSince`);
    }
    const cursorClause = request.cursor === undefined ? '' : 'AND (COALESCE(p.taken_at, p.imported_at), p.id) < (@cursorKey, @cursorId)';
    const rows = queryAll<PhotoRow>(
      this.db,
      `${SELECT}
       WHERE ${sourceWhere(request.source)} ${cursorClause}
       ORDER BY sort_key DESC, p.id DESC
       LIMIT @limit`,
      {
        limit: request.limit,
        recentSince: request.recentSince ?? null,
        cursorKey: request.cursor?.sortKey ?? null,
        cursorId: request.cursor?.id ?? null,
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
      run(this.db, 'UPDATE sync_ledger SET dirty = 1 WHERE photo_id = ?', photoId);
      return updated.favorite === 1;
    })();
  }

  counts(recentSince: string): SourceCounts {
    const one = (where: string): number =>
      queryAll<{ n: number }>(this.db, `SELECT count(*) AS n FROM photos p WHERE ${where}`, {
        recentSince,
      })[0]?.n ?? 0;
    return {
      all: one('p.deleted_at IS NULL'),
      favorites: one('p.deleted_at IS NULL AND p.favorite = 1'),
      recent: one('p.deleted_at IS NULL AND p.imported_at >= @recentSince'),
      offloaded: one(`p.deleted_at IS NULL AND p.id IN (SELECT photo_id FROM sync_ledger WHERE status = 'offloaded')`),
      deleted: one('p.deleted_at IS NOT NULL'),
    };
  }
}
