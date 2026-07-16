import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';

import { queryAll, queryGet, runNamed } from '../db/sql.js';
import { interopReviewCategorySchema, type InteropProduct, type InteropReviewCategory } from '../../shared/interop/contract.js';
import { interopAlbumSchema, interopRecordSchema, type InteropAlbum, type InteropRecord } from '../../shared/interop/records.js';

const receivedAtSchema = z.string().datetime();

interface InteropRecordRow {
  interop_id: string;
  origin_product: string;
  origin_local_id: string;
  content_hash: string | null;
  local_photo_id: string | null;
  review_category: string;
  record_json: string;
  received_at: string;
}

interface InteropAlbumRow {
  interop_id: string;
  origin_product: string;
  origin_local_id: string;
  local_album_id: string | null;
  album_json: string;
  received_at: string;
}

export interface StoredInteropRecord {
  readonly record: InteropRecord;
  readonly reviewCategory: InteropReviewCategory;
  readonly localPhotoId: string | null;
  readonly receivedAt: string;
}

export interface StoredInteropAlbum {
  readonly album: InteropAlbum;
  readonly localAlbumId: string | null;
  readonly receivedAt: string;
}

export class InteropRepositoryError extends Error {
  override readonly name = 'InteropRepositoryError';
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new InteropRepositoryError('Stored interoperability JSON is corrupt.');
  }
}

function hydrateRecord(row: InteropRecordRow): StoredInteropRecord {
  const record = interopRecordSchema.parse(parseJson(row.record_json));
  const reviewCategory = interopReviewCategorySchema.parse(row.review_category);
  const receivedAt = receivedAtSchema.parse(row.received_at);
  if (
    record.identity.interopId !== row.interop_id ||
    record.identity.origin.product !== row.origin_product ||
    record.identity.origin.localId !== row.origin_local_id ||
    record.identity.contentHash !== row.content_hash
  ) {
    throw new InteropRepositoryError('Stored interoperability record index does not match its canonical payload.');
  }
  return { record, reviewCategory, localPhotoId: row.local_photo_id, receivedAt };
}

function hydrateAlbum(row: InteropAlbumRow): StoredInteropAlbum {
  const album = interopAlbumSchema.parse(parseJson(row.album_json));
  const receivedAt = receivedAtSchema.parse(row.received_at);
  if (album.interopId !== row.interop_id || album.origin.product !== row.origin_product || album.origin.localId !== row.origin_local_id) {
    throw new InteropRepositoryError('Stored interoperability album index does not match its canonical payload.');
  }
  return { album, localAlbumId: row.local_album_id, receivedAt };
}

export class InteropRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  putRecord(input: {
    readonly record: InteropRecord;
    readonly reviewCategory: InteropReviewCategory;
    readonly receivedAt: string;
    readonly localPhotoId?: string | null | undefined;
  }): void {
    const record = interopRecordSchema.parse(input.record);
    const reviewCategory = interopReviewCategorySchema.parse(input.reviewCategory);
    const receivedAt = receivedAtSchema.parse(input.receivedAt);
    runNamed(
      this.db,
      `INSERT INTO interop_records (
         interop_id, origin_product, origin_local_id, content_hash, local_photo_id,
         review_category, record_json, received_at
       ) VALUES (
         @interopId, @originProduct, @originLocalId, @contentHash, @localPhotoId,
         @reviewCategory, @recordJson, @receivedAt
       )
       ON CONFLICT (interop_id) DO UPDATE SET
         origin_product = excluded.origin_product,
         origin_local_id = excluded.origin_local_id,
         content_hash = excluded.content_hash,
         local_photo_id = COALESCE(excluded.local_photo_id, interop_records.local_photo_id),
         review_category = excluded.review_category,
         record_json = excluded.record_json,
         received_at = excluded.received_at`,
      {
        interopId: record.identity.interopId,
        originProduct: record.identity.origin.product,
        originLocalId: record.identity.origin.localId,
        contentHash: record.identity.contentHash,
        localPhotoId: input.localPhotoId ?? null,
        reviewCategory,
        recordJson: JSON.stringify(record),
        receivedAt,
      },
    );
  }

  getRecord(interopId: string): StoredInteropRecord | undefined {
    const row = queryGet<InteropRecordRow>(this.db, 'SELECT * FROM interop_records WHERE interop_id = ?', interopId);
    return row === undefined ? undefined : hydrateRecord(row);
  }

  findRecordByOrigin(product: InteropProduct, localId: string): StoredInteropRecord | undefined {
    const row = queryGet<InteropRecordRow>(
      this.db,
      'SELECT * FROM interop_records WHERE origin_product = ? AND origin_local_id = ?',
      product,
      localId,
    );
    return row === undefined ? undefined : hydrateRecord(row);
  }

  findRecordsByContentHash(contentHash: string): readonly StoredInteropRecord[] {
    return queryAll<InteropRecordRow>(this.db, 'SELECT * FROM interop_records WHERE content_hash = @contentHash ORDER BY interop_id', {
      contentHash,
    }).map(hydrateRecord);
  }

  putAlbum(input: { readonly album: InteropAlbum; readonly receivedAt: string; readonly localAlbumId?: string | null | undefined }): void {
    const album = interopAlbumSchema.parse(input.album);
    const receivedAt = receivedAtSchema.parse(input.receivedAt);
    runNamed(
      this.db,
      `INSERT INTO interop_albums (
         interop_id, origin_product, origin_local_id, local_album_id, album_json, received_at
       ) VALUES (@interopId, @originProduct, @originLocalId, @localAlbumId, @albumJson, @receivedAt)
       ON CONFLICT (interop_id) DO UPDATE SET
         origin_product = excluded.origin_product,
         origin_local_id = excluded.origin_local_id,
         local_album_id = COALESCE(excluded.local_album_id, interop_albums.local_album_id),
         album_json = excluded.album_json,
         received_at = excluded.received_at`,
      {
        interopId: album.interopId,
        originProduct: album.origin.product,
        originLocalId: album.origin.localId,
        localAlbumId: input.localAlbumId ?? null,
        albumJson: JSON.stringify(album),
        receivedAt,
      },
    );
  }

  getAlbum(interopId: string): StoredInteropAlbum | undefined {
    const row = queryGet<InteropAlbumRow>(this.db, 'SELECT * FROM interop_albums WHERE interop_id = ?', interopId);
    return row === undefined ? undefined : hydrateAlbum(row);
  }
}
