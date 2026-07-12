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

/** A tiny valid JPEG whose bytes vary by index (COM segment payload). */
export function sampleJpeg(index: number): Buffer {
  const comment = Buffer.from(`overlook-seed-${String(index).padStart(6, '0')}`, 'ascii');
  const com = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from([(comment.length + 2) >> 8, (comment.length + 2) & 0xff]), comment]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    com,
    // Minimal JFIF APP0.
    Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

function seedPhoto(index: number): Omit<PhotoInsert, 'contentHash' | 'bytes' | 'keyId'> {
  const n = String(index).padStart(4, '0');
  const raw = index % 5 === 0;
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
    takenAt: `2026-${String(6 - (index >> 5)).padStart(2, '0')}-${String(28 - (index % 27)).padStart(2, '0')}T12:00:00.000Z`,
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
  })();
  return count;
}
