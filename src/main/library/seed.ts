import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import type { BlobStore } from '../blobs/blob-store.js';
import type { EnvelopeKey } from '../crypto/envelope.js';
import { PhotosRepository } from '../db/photos-repository.js';
import { run, runNamed } from '../db/sql.js';
import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import type { PhotoInsert } from '../../shared/library/types.js';

// Deterministic dev/E2E seed (#72): real encrypted data through the real
// path — envelope-encrypted blobs, SQLCipher rows, mock-shaped metadata.
// Determinism: ids, dates, and file bytes derive from the index only, so
// content hashes and page orders are stable across runs and machines.

const CAMERAS = ['FUJIFILM X-T5', 'SONY A7 IV', 'APPLE iPHONE 15 PRO', 'RICOH GR III'];
const LENSES = ['XF 35MM F/1.4', 'FE 24-70MM F/2.8', 'MAIN 24MM F/1.78', 'GR 18.3MM F/2.8'];
const PLACES = ['Lisbon', 'Big Sur', 'Kyoto', 'Home', 'Dolomites', 'Brooklyn'];
const STATUSES = ['local', 'synced', 'synced', 'synced', 'offloaded', 'syncing', 'synced', 'local'] as const;

export const SEED_ALBUMS = ['Travel 2026', 'Family', 'Big Sur', 'Kyoto Spring'] as const;

const SEED_PHOTO_FILES = ['summer-landscape.jpg', 'street-city.jpg', 'flower-landscape.jpg', 'street-square.jpg'] as const;
let seedPhotoBytes: readonly Buffer[] | null = null;

function realSeedPhotos(): readonly Buffer[] {
  seedPhotoBytes ??= SEED_PHOTO_FILES.map((file) => readFileSync(join(process.cwd(), 'tests/fixtures/photos', file)));
  return seedPhotoBytes;
}

/** A licensed real photograph whose bytes vary by index (COM after SOI). */
export function sampleJpeg(index: number): Buffer {
  const photos = realSeedPhotos();
  const photo = photos[index % photos.length];
  if (!photo) throw new Error('real seed-photo fixture set is empty');
  const comment = Buffer.from(`overlook-seed-${String(index).padStart(6, '0')}`, 'ascii');
  const com = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from([(comment.length + 2) >> 8, (comment.length + 2) & 0xff]), comment]);
  return Buffer.concat([
    photo.subarray(0, 2), // SOI
    com,
    photo.subarray(2), // JFIF header, tables, scan, EOI
  ]);
}

function seedPhoto(index: number): Omit<PhotoInsert, 'contentHash' | 'bytes' | 'keyId'> {
  const n = String(index).padStart(4, '0');
  const raw = index % 5 === 0;
  // Walk backwards one month every 32 photos from June 2026, rolling the
  // year over so any index yields a valid ISO date (PR #152 review).
  const totalMonths = 2026 * 12 + 5 - (index >> 5);
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  return {
    id: `01J8SEEDPHOTO${n}`,
    fileName: `IMG_${String(4021 + index * 7)}${raw ? '.RAF' : '.JPG'}`,
    fileKind: raw ? 'raw' : 'jpeg',
    width: 6240,
    height: 4160,
    camera: CAMERAS[index % 4] ?? null,
    lens: LENSES[index % 4] ?? null,
    iso: [125, 200, 400, 800][index % 4] ?? null,
    aperture: ['1.8', '2.8', '4.0', '5.6'][index % 4] ?? null,
    shutter: ['1/250', '1/125', '1/60', '1/1000'][index % 4] ?? null,
    focalLength: [23, 35, 50, 28][index % 4] ?? null,
    takenAt: `${String(year)}-${String(month).padStart(2, '0')}-${String(28 - (index % 27)).padStart(2, '0')}T12:00:00.000Z`,
    gpsLat: null,
    gpsLon: null,
    place: PLACES[index % 6] ?? null,
    importedAt: '2026-07-01T00:00:00.000Z',
    importSource: 'seed',
    favorite: index % 9 === 0,
  };
}

export interface SeedResult {
  readonly photos: number;
  readonly albums: number;
}

/** Seeds an EMPTY library through the real crypto/blob/DB path. */
export async function seedLibrary(db: BetterSqlite3.Database, blobStore: BlobStore, key: EnvelopeKey, count: number): Promise<SeedResult> {
  const repo = new PhotosRepository(db);
  if (repo.stats().photos > 0) {
    return { photos: 0, albums: 0 };
  }
  run(db, `INSERT OR IGNORE INTO keys (id, wrapped_key, created_at) VALUES (?, 'seed-managed', ?)`, key.id, '2026-07-01T00:00:00.000Z');

  for (let index = 0; index < count; index += 1) {
    const meta = seedPhoto(index);
    const bytes = sampleJpeg(index);
    const ref = await blobStore.putOriginal(Readable.from([bytes]), key, meta.id);
    // Real encrypted photo thumbs so the grid exercises the #75 protocol.
    await blobStore.putThumb(Readable.from([bytes]), key, meta.id, ref.contentHash, 'thumb');
    repo.insert({ ...meta, contentHash: ref.contentHash, bytes: ref.bytes, keyId: key.id });
    const status = STATUSES[index % 8] ?? 'local';
    if (status !== 'local') {
      run(db, 'UPDATE sync_ledger SET status = ?, dirty = ? WHERE photo_id = ?', status, status === 'syncing' ? 1 : 0, meta.id);
    }
  }

  SEED_ALBUMS.forEach((name, albumIndex) => {
    const albumId = `01J8SEEDALBUM${String(albumIndex).padStart(3, '0')}`;
    runNamed(db, 'INSERT INTO albums (id, name, created_at, position) VALUES (@id, @name, @createdAt, @position)', {
      id: albumId,
      name,
      createdAt: '2026-07-01T00:00:00.000Z',
      position: albumIndex,
    });
    // Every 4th photo joins one album, rotating — deterministic membership.
    for (let index = albumIndex; index < count; index += 4) {
      runNamed(db, 'INSERT INTO album_photos (album_id, photo_id, position) VALUES (@albumId, @photoId, @position)', {
        albumId,
        photoId: `01J8SEEDPHOTO${String(index).padStart(4, '0')}`,
        position: index,
      });
    }
  });

  return { photos: count, albums: SEED_ALBUMS.length };
}

/** Metadata-only synthetic rows sharing one blob — the 200K perf variant. */
export function seedSynthetic(db: BetterSqlite3.Database, keyId: number, contentHashPrefix: string, count: number): number {
  const repo = new PhotosRepository(db);
  // Standalone runs (OVERLOOK_SEED_SYNTHETIC) start from a fresh profile
  // where nothing has inserted the key row yet (photos.key_id FK).
  run(db, `INSERT OR IGNORE INTO keys (id, wrapped_key, created_at) VALUES (?, 'seed-managed', ?)`, keyId, '2026-07-01T00:00:00.000Z');
  db.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      const n = String(index).padStart(7, '0');
      repo.insert({
        ...seedPhoto(index % 800),
        id: `01J8SYNTH${n}`,
        contentHash: `${contentHashPrefix}-${n}`,
        bytes: 8_400_000,
        keyId,
      });
    }
    // The scale profile simulates a SETTLED, backed-up library (#123):
    // born-dirty synthetic rows have no uploadable blobs, so they poison
    // pending counts and doom any backup run with 200K guaranteed failures.
    run(db, `UPDATE sync_ledger SET status = 'synced', dirty = 0 WHERE photo_id LIKE '01J8SYNTH%'`);
  })();
  return count;
}
