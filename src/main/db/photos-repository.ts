import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

import { markDirty } from '../backup/sync-ledger.js';
import type { BackupIntegrityItem } from '../backup/integrity-scrubber.js';
import type { BackupManifestPhotoV2, BackupManifestSnapshot, RestorableBackupManifest } from '../backup/backup-manifest.js';
import type { WrappedKeyRecord } from '../crypto/keystore.js';
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
  FROM ordinary_visible_photos p
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
      // Join-based (photo_id is the ledger PK, so the join is 1:1): usable
      // in page() AND as a single-pass counts() FILTER clause (#124 — the
      // IN-subquery form cost ~700ms at 200K).
      return `p.deleted_at IS NULL AND l.status = 'offloaded'`;
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
        `UPDATE photos SET favorite = 1 - favorite
          WHERE id = ? AND id IN (SELECT id FROM ordinary_visible_photos)
          RETURNING favorite`,
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

  /** Repairs legacy unknown dimensions without overwriting trusted metadata. */
  repairDimensions(photoId: string, width: number, height: number): boolean {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError('photo dimensions must be positive safe integers');
    }
    return this.db.transaction(() => {
      const repaired = queryGet<{ id: string }>(
        this.db,
        `UPDATE photos SET width = @width, height = @height
         WHERE id = @id AND (width <= 0 OR height <= 0)
         RETURNING id`,
        { id: photoId, width, height },
      );
      if (repaired === undefined) return false;
      markDirty(this.db, photoId);
      return true;
    })();
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
          `UPDATE photos SET deleted_at = @at
            WHERE id = @photoId AND deleted_at IS NULL
              AND id IN (SELECT id FROM ordinary_visible_photos)
            RETURNING id`,
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
          `UPDATE photos SET deleted_at = NULL
            WHERE id = @photoId AND deleted_at IS NOT NULL
              AND id IN (SELECT id FROM ordinary_visible_photos)
            RETURNING id`,
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
      'SELECT count(*) AS n, sum(bytes) AS b FROM ordinary_visible_photos p WHERE p.deleted_at IS NULL',
    )[0];
    const lastBackupAt =
      queryAll<{ at: string | null }>(
        this.db,
        `SELECT max(l.last_backup_at) AS at
           FROM sync_ledger l JOIN ordinary_visible_photos p ON p.id = l.photo_id`,
      )[0]?.at ?? null;
    const offloadedBytes =
      queryAll<{ b: number | null }>(
        this.db,
        `SELECT sum(p.bytes) AS b FROM ordinary_visible_photos p JOIN sync_ledger l ON l.photo_id = p.id
          WHERE l.status = 'offloaded' AND p.deleted_at IS NULL`,
      )[0]?.b ?? 0;
    return { photos: row?.n ?? 0, bytes: row?.b ?? 0, pending: this.pendingCount(), lastBackupAt, offloadedBytes };
  }

  /** Dedupe primitive (#84): does this content already live in the library?
   *  Deleted-but-unpurged photos still own their blobs, so no deleted_at
   *  filter — re-importing them is still "not new". */
  hasContentHash(contentHash: string): boolean {
    return (
      queryGet<{ one: number }>(this.db, 'SELECT 1 AS one FROM ordinary_visible_photos WHERE content_hash = ? LIMIT 1', contentHash) !==
      undefined
    );
  }

  /** Sidebar albums list (#80): names + live membership counts. */
  albums(): AlbumSummary[] {
    return queryAll<{ id: string; name: string; n: number }>(
      this.db,
      `SELECT a.id, a.name, count(ap.photo_id) AS n
       FROM albums a
       LEFT JOIN album_photos ap
         ON ap.album_id = a.id
        AND ap.photo_id IN (SELECT id FROM ordinary_visible_photos)
       GROUP BY a.id ORDER BY a.position`,
    ).map((row) => ({ id: row.id, name: row.name, count: row.n }));
  }

  /** Album members — the rows an album edit dirties (manifest-relevant
   * per ADR-0007). */
  albumMembers(albumId: string): string[] {
    return queryAll<{ photo_id: string }>(
      this.db,
      `SELECT ap.photo_id FROM album_photos ap
        JOIN ordinary_visible_photos p ON p.id = ap.photo_id
       WHERE ap.album_id = @albumId ORDER BY ap.position`,
      { albumId },
    ).map((row) => row.photo_id);
  }

  albumForProtection(albumId: string):
    | {
        readonly id: string;
        readonly name: string;
        readonly createdAt: string;
        readonly position: number;
        readonly photoIds: readonly string[];
      }
    | undefined {
    const album = queryGet<{ id: string; name: string; createdAt: string; position: number }>(
      this.db,
      `SELECT id, name, created_at AS createdAt, position FROM albums WHERE id = ?`,
      albumId,
    );
    return album === undefined ? undefined : { ...album, photoIds: this.albumMembers(albumId) };
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
           SELECT @albumId, @photoId, (SELECT COALESCE(max(position) + 1, 0) FROM album_photos WHERE album_id = @albumId)
            WHERE EXISTS (SELECT 1 FROM ordinary_visible_photos WHERE id = @photoId)
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
          `DELETE FROM album_photos
            WHERE album_id = @albumId AND photo_id = @photoId
              AND photo_id IN (SELECT id FROM ordinary_visible_photos)
            RETURNING photo_id`,
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

  /** Moves memberships atomically: the target row is present before the
   * source row is removed, and each moved photo is dirtied exactly once. */
  moveBetweenAlbums(
    sourceAlbumId: string,
    targetAlbumId: string,
    photoIds: readonly string[],
  ): { moved: string[]; alreadyInTarget: number } {
    return this.db.transaction(() => {
      if (sourceAlbumId === targetAlbumId) {
        throw new Error('source and target albums must differ');
      }
      for (const albumId of [sourceAlbumId, targetAlbumId]) {
        if (queryGet<{ one: number }>(this.db, 'SELECT 1 AS one FROM albums WHERE id = ?', albumId) === undefined) {
          throw new Error(`album ${albumId} does not exist`);
        }
      }
      const moved: string[] = [];
      let alreadyInTarget = 0;
      for (const photoId of photoIds) {
        const sourceMember = queryGet<{ one: number }>(
          this.db,
          `SELECT 1 AS one FROM album_photos ap
             JOIN ordinary_visible_photos p ON p.id = ap.photo_id
            WHERE ap.album_id = @sourceAlbumId AND ap.photo_id = @photoId`,
          { sourceAlbumId, photoId },
        );
        if (sourceMember === undefined) continue;
        const inserted = queryGet<{ photo_id: string }>(
          this.db,
          `INSERT OR IGNORE INTO album_photos (album_id, photo_id, position)
           VALUES (@targetAlbumId, @photoId, (SELECT COALESCE(max(position) + 1, 0) FROM album_photos WHERE album_id = @targetAlbumId))
           RETURNING photo_id`,
          { targetAlbumId, photoId },
        );
        if (inserted === undefined) alreadyInTarget += 1;
        runNamed(this.db, 'DELETE FROM album_photos WHERE album_id = @sourceAlbumId AND photo_id = @photoId', { sourceAlbumId, photoId });
        markDirty(this.db, photoId);
        moved.push(photoId);
      }
      return { moved, alreadyInTarget };
    })();
  }

  /** Purge candidates only (#121): the row, iff it is soft-deleted. */
  getDeleted(photoId: string): PhotoRecord | undefined {
    const row = this.get(photoId);
    return row !== undefined && row.deletedAt !== null ? row : undefined;
  }

  /** Soft-deleted longer than the retention window (#121's auto-purge). */
  expiredDeleted(cutoffIso: string): string[] {
    return queryAll<{ id: string }>(
      this.db,
      'SELECT id FROM ordinary_visible_photos WHERE deleted_at IS NOT NULL AND deleted_at < @cutoff',
      { cutoff: cutoffIso },
    ).map((row) => row.id);
  }

  /** Removes the DB row (ledger + membership CASCADE). Deleted rows only —
   * a live row can never be purged, only soft-deleted first. */
  purgeRow(photoId: string): void {
    const gone = queryGet<{ id: string }>(
      this.db,
      `DELETE FROM photos
        WHERE id = ? AND deleted_at IS NOT NULL
          AND id IN (SELECT id FROM ordinary_visible_photos)
        RETURNING id`,
      photoId,
    );
    if (gone === undefined) {
      throw new Error(`photo ${photoId} is not in Recently deleted`);
    }
  }

  /** Blob-ownership count for PURGE (#121): every remaining row on this
   * hash, deleted or not — soft-deleted twins still own their blobs. */
  countAnyByContentHash(contentHash: string): number {
    return (
      queryAll<{ n: number }>(this.db, 'SELECT count(*) AS n FROM photos WHERE content_hash = @hash', { hash: contentHash })[0]?.n ?? 0
    );
  }

  /** Ordinary consistency rows only. Hidden migration custody is supplied
   * separately as ownership-only hashes so it can never enter reports. */
  allRows(): readonly { id: string; contentHash: string; syncState: string }[] {
    return queryAll<{ id: string; content_hash: string; status: string | null }>(
      this.db,
      `SELECT p.id, p.content_hash, l.status
         FROM ordinary_visible_photos p LEFT JOIN sync_ledger l ON l.photo_id = p.id`,
    ).map((row) => ({ id: row.id, contentHash: row.content_hash, syncState: row.status ?? 'local' }));
  }

  /** Ordinary blob references held by an in-flight protected migration.
   * Values protect live custody from orphan cleanup but are never surfaced as
   * rows, diagnostics, events, or audit identifiers. */
  migrationOwnedContentHashes(): readonly string[] {
    return queryAll<{ contentHash: string }>(
      this.db,
      `SELECT DISTINCT CASE journal.operation
         WHEN 'protect' THEN item.source_blob_ref
         ELSE item.target_blob_ref
       END AS contentHash
       FROM protected_photo_migration_items item
       JOIN protected_photo_migrations journal ON journal.migration_id = item.migration_id
       WHERE journal.operation IN ('protect', 'unprotect')`,
    ).map((row) => row.contentHash);
  }

  /** Shared-hash guard for offload (#107): live photos on this hash. */
  countByContentHash(contentHash: string): number {
    return (
      queryAll<{ n: number }>(this.db, 'SELECT count(*) AS n FROM photos WHERE content_hash = @hash AND deleted_at IS NULL', {
        hash: contentHash,
      })[0]?.n ?? 0
    );
  }

  /** Live originals managed from Settings; deleted rows retain their
   * existing recovery policy and are not silently resurrected. */
  offloadedPhotoIds(): string[] {
    return queryAll<{ id: string }>(
      this.db,
      `SELECT p.id
         FROM ordinary_visible_photos p JOIN sync_ledger l ON l.photo_id = p.id
        WHERE p.deleted_at IS NULL AND l.status = 'offloaded'
        ORDER BY p.imported_at, p.id`,
    ).map(({ id }) => id);
  }

  /** One read transaction captures every remotely recoverable row plus
   * album ordering/membership (#289). Deleted rows join only when their
   * original is already remote; a never-backed-up deleted blob cannot be
   * promised by a disaster-recovery manifest. */
  manifestSnapshot(): BackupManifestSnapshot {
    return this.db.transaction(() => {
      const recoverable = `(p.deleted_at IS NULL OR (p.deleted_at IS NOT NULL AND l.status IN ('synced', 'offloaded')))`;
      const photos = queryAll<PhotoRow>(this.db, `${select('date')} WHERE ${recoverable} ORDER BY p.imported_at, p.id`).map(
        (row): BackupManifestPhotoV2 => {
          const { syncState: _syncState, ...photo } = toRecord(row);
          return {
            ...photo,
            blobPath: `blobs/${photo.contentHash.slice(0, 2)}/${photo.contentHash}`,
          };
        },
      );
      const photoIds = new Set(photos.map((photo) => photo.id));
      const albumRows = queryAll<{ id: string; name: string; createdAt: string; position: number }>(
        this.db,
        `SELECT id, name, created_at AS createdAt, position FROM albums ORDER BY position, id`,
      );
      const members = queryAll<{ albumId: string; photoId: string }>(
        this.db,
        `SELECT ap.album_id AS albumId, ap.photo_id AS photoId
           FROM album_photos ap
           JOIN albums a ON a.id = ap.album_id
           JOIN ordinary_visible_photos p ON p.id = ap.photo_id
           JOIN sync_ledger l ON l.photo_id = p.id
          WHERE ${recoverable}
          ORDER BY a.position, a.id, ap.position, ap.photo_id`,
      );
      const membersByAlbum = new Map<string, string[]>();
      for (const member of members) {
        if (!photoIds.has(member.photoId)) {
          continue;
        }
        const existing = membersByAlbum.get(member.albumId) ?? [];
        existing.push(member.photoId);
        membersByAlbum.set(member.albumId, existing);
      }
      const albums = albumRows.map((album) => ({ ...album, photoIds: membersByAlbum.get(album.id) ?? [] }));
      const databaseSchema = queryGet<{ version: number }>(this.db, 'SELECT max(version) AS version FROM schema_migrations')?.version ?? 1;
      const keyIds = [...new Set(photos.map((photo) => photo.keyId))].sort((a, b) => a - b);
      return {
        databaseSchema,
        keyIds,
        photos,
        albums,
        totals: {
          photos: photos.length,
          bytes: photos.reduce((sum, photo) => sum + photo.bytes, 0),
          albums: albums.length,
        },
      };
    })();
  }

  /** Rebuilds a fresh catalog from a verified manifest (#288). The staged
   * DB must be empty: merge semantics could retain local-only rows and turn
   * disaster recovery into silent data loss. All restored originals are
   * already verified remote copies, so their ledgers start clean + synced. */
  restoreManifest(manifest: RestorableBackupManifest, keys: readonly WrappedKeyRecord[]): void {
    this.db.transaction(() => {
      const occupied = queryGet<{ count: number }>(
        this.db,
        `SELECT (SELECT count(*) FROM photos) + (SELECT count(*) FROM albums) + (SELECT count(*) FROM keys) AS count`,
      );
      if ((occupied?.count ?? 0) !== 0) throw new Error('restore requires an empty staged catalog');
      for (const key of keys) {
        runNamed(
          this.db,
          `INSERT INTO keys (id, wrapped_key, created_at, retired_at)
           VALUES (@id, @wrappedKey, @createdAt, @retiredAt)`,
          {
            id: key.id,
            wrappedKey: key.wrappedKey,
            createdAt: key.createdAt,
            retiredAt: key.status === 'retired' ? manifest.generatedAt : null,
          },
        );
      }
      for (const photo of manifest.photos) {
        runNamed(
          this.db,
          `INSERT INTO photos (
             id, file_name, file_kind, width, height, bytes, content_hash,
             camera, lens, iso, aperture, shutter, focal_length, taken_at,
             gps_lat, gps_lon, place, imported_at, import_source, favorite,
             key_id, deleted_at
           ) VALUES (
             @id, @fileName, @fileKind, @width, @height, @bytes, @contentHash,
             @camera, @lens, @iso, @aperture, @shutter, @focalLength, @takenAt,
             @gpsLat, @gpsLon, @place, @importedAt, @importSource, @favorite,
             @keyId, @deletedAt
           )`,
          { ...photo, favorite: photo.favorite ? 1 : 0 },
        );
        run(
          this.db,
          `INSERT INTO sync_ledger (photo_id, status, last_backup_at, dirty)
           VALUES (?, 'synced', ?, 0)`,
          photo.id,
          manifest.generatedAt,
        );
      }
      for (const album of manifest.albums) {
        runNamed(this.db, `INSERT INTO albums (id, name, created_at, position) VALUES (@id, @name, @createdAt, @position)`, album);
        for (const [position, photoId] of album.photoIds.entries()) {
          run(this.db, `INSERT INTO album_photos (album_id, photo_id, position) VALUES (?, ?, ?)`, album.id, photoId, position);
        }
      }
    })();
  }

  /** The backup queue's input (#105): dirty, not-deleted photos. */
  dirtyPhotos(): readonly { id: string; contentHash: string; bytes: number; fileName: string; keyId: number }[] {
    return queryAll<{ id: string; contentHash: string; bytes: number; fileName: string; keyId: number }>(
      this.db,
      `SELECT p.id, p.content_hash AS contentHash, p.bytes, p.file_name AS fileName, p.key_id AS keyId
         FROM ordinary_visible_photos p JOIN sync_ledger l ON l.photo_id = p.id
        WHERE l.dirty = 1 AND p.deleted_at IS NULL
        ORDER BY p.imported_at, p.id`,
    );
  }

  /** Stable keyset page over rows whose remote-copy claim must remain true.
   * Deleted-but-retained photos are included because recovery still promises
   * their original until permanent purge. */
  integrityItems(page: { readonly afterId: string | null; readonly limit: number }): readonly BackupIntegrityItem[] {
    return queryAll<BackupIntegrityItem>(
      this.db,
      `SELECT p.id, p.content_hash AS contentHash, l.status AS syncState
         FROM ordinary_visible_photos p
         JOIN sync_ledger l ON l.photo_id = p.id
        WHERE l.status IN ('synced', 'offloaded')
          AND (@afterId IS NULL OR p.id > @afterId)
        ORDER BY p.id
        LIMIT @limit`,
      { afterId: page.afterId, limit: page.limit },
    );
  }

  /** pendingCount source: dirty ledger rows (design §backup dirtiness). */
  pendingCount(): number {
    // Deleted rows leave the pending count (#120): they neither upload
    // (dirtyPhotos filters them) nor belong in provider upload progress.
    return (
      queryAll<{ n: number }>(
        this.db,
        'SELECT count(*) AS n FROM sync_ledger l JOIN ordinary_visible_photos p ON p.id = l.photo_id WHERE l.dirty = 1 AND p.deleted_at IS NULL',
      )[0]?.n ?? 0
    );
  }

  /** Sidebar counts share page()'s sourceWhere — ONE query truth per
   * source, so counts and grid results cannot drift (#119; the mock's
   * fall-through gap, fixed by construction). Single pass over the join
   * with FILTER clauses (#124): five separate counts cost ~690ms at 200K;
   * one scan serves them all. */
  counts(recentSince: string): SourceCounts {
    const sources = ['all', 'favorites', 'recent', 'offloaded', 'deleted'] as const;
    const filters = sources.map((source) => `count(*) FILTER (WHERE ${sourceWhere(source)}) AS "${source}"`).join(', ');
    const row = queryAll<Record<(typeof sources)[number], number>>(
      this.db,
      `SELECT ${filters} FROM ordinary_visible_photos p LEFT JOIN sync_ledger l ON l.photo_id = p.id`,
      { recentSince },
    )[0];
    return {
      all: row?.all ?? 0,
      favorites: row?.favorites ?? 0,
      recent: row?.recent ?? 0,
      offloaded: row?.offloaded ?? 0,
      deleted: row?.deleted ?? 0,
    };
  }
}
