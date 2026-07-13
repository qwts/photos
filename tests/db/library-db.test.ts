import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3-multiple-ciphers';

import { openLibraryDatabase, LibraryDatabaseError } from '../../src/main/db/database.js';
import { queryAll, queryGet, run } from '../../src/main/db/sql.js';
import { migrate, MIGRATIONS } from '../../src/main/db/migrations.js';
import { PhotosRepository } from '../../src/main/db/photos-repository.js';
import type { PhotoInsert } from '../../src/shared/library/types.js';

const DB_KEY = randomBytes(32);

function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'overlook-db-')), 'library.db');
}

let seq = 0;
// The mock's field set (design ui_kits photos.js) — camera/lens/EXIF/place.
function samplePhoto(overrides: Partial<PhotoInsert> = {}): PhotoInsert {
  seq += 1;
  const n = String(seq).padStart(6, '0');
  return {
    id: `01J8PHOTO${n}`,
    fileName: `IMG_${n}.RAF`,
    fileKind: 'raw',
    width: 6240,
    height: 4160,
    bytes: 54_200_000,
    contentHash: `hash-${n}`,
    camera: 'FUJIFILM X-T5',
    lens: 'XF 35MM F/1.4',
    iso: 125,
    aperture: '1.8',
    shutter: '1/250',
    focalLength: 23,
    takenAt: `2026-06-${String((seq % 27) + 1).padStart(2, '0')}T12:00:00.000Z`,
    gpsLat: 35.0116,
    gpsLon: 135.7681,
    place: 'Kyoto',
    importedAt: '2026-07-01T00:00:00.000Z',
    importSource: 'sd-card',
    keyId: 1,
    ...overrides,
  };
}

function openSeeded(path = tempDbPath()): { db: Database.Database; repo: PhotosRepository } {
  const db = openLibraryDatabase({ path, dbKey: DB_KEY });
  run(db, `INSERT INTO keys (id, wrapped_key, created_at) VALUES (1, 'wrapped-test-key', ?)`, new Date().toISOString());
  return { db, repo: new PhotosRepository(db) };
}

describe('openLibraryDatabase', () => {
  test('applies SQLCipher: a keyless open cannot read the file', () => {
    const path = tempDbPath();
    const db = openLibraryDatabase({ path, dbKey: DB_KEY });
    db.close();
    const raw = new Database(path);
    assert.throws(() => raw.prepare('SELECT count(*) FROM sqlite_master').get());
    raw.close();
  });

  test('a wrong key fails loudly with a named error', () => {
    const path = tempDbPath();
    openLibraryDatabase({ path, dbKey: DB_KEY }).close();
    assert.throws(
      () => openLibraryDatabase({ path, dbKey: randomBytes(32) }),
      (error: unknown) => error instanceof LibraryDatabaseError,
    );
  });

  test('short keys are refused', () => {
    assert.throws(() => openLibraryDatabase({ path: tempDbPath(), dbKey: randomBytes(16) }), /32 bytes/);
  });

  test('WAL and foreign keys are on', () => {
    const db = openLibraryDatabase({ path: tempDbPath(), dbKey: DB_KEY });
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    db.close();
  });
});

describe('migrations', () => {
  test('migrations apply cleanly twice (second run is a no-op)', () => {
    const db = openLibraryDatabase({ path: tempDbPath(), dbKey: DB_KEY });
    // openLibraryDatabase already migrated once.
    assert.equal(migrate(db, MIGRATIONS), 0);
    const versions = queryAll<{ version: number }>(db, 'SELECT version FROM schema_migrations');
    assert.deepEqual(
      versions.map((row) => row.version),
      [1, 2],
    );
    db.close();
  });

  test('migrations apply in version order and are transactional', () => {
    const db = openLibraryDatabase({ path: tempDbPath(), dbKey: DB_KEY });
    const order: number[] = [];
    const extra = [
      { version: 4, name: 'four', up: () => order.push(4) },
      { version: 3, name: 'three', up: () => order.push(3) },
    ];
    assert.equal(migrate(db, [...MIGRATIONS, ...extra]), 2);
    assert.deepEqual(order, [3, 4]);
    db.close();
  });

  test('a failing migration rolls back and records nothing', () => {
    const db = openLibraryDatabase({ path: tempDbPath(), dbKey: DB_KEY });
    const bad = {
      version: 3,
      name: 'bad',
      up: (d: Database.Database) => {
        d.exec('CREATE TABLE half_done (a TEXT)');
        throw new Error('boom');
      },
    };
    assert.throws(() => migrate(db, [...MIGRATIONS, bad]), /boom/);
    assert.equal(queryGet<{ n: number }>(db, `SELECT count(*) AS n FROM sqlite_master WHERE name = 'half_done'`)?.n, 0);
    assert.equal(queryGet<{ v: number }>(db, 'SELECT max(version) AS v FROM schema_migrations')?.v, 2);
    db.close();
  });
});

describe('PhotosRepository', () => {
  test('round-trips the mock field set', () => {
    const { db, repo } = openSeeded();
    const photo = samplePhoto();
    repo.insert(photo);
    const page = repo.page({ source: 'all', limit: 10 });
    assert.equal(page.photos.length, 1);
    const stored = page.photos[0]!;
    assert.equal(stored.fileName, photo.fileName);
    assert.equal(stored.camera, 'FUJIFILM X-T5');
    assert.equal(stored.lens, 'XF 35MM F/1.4');
    assert.equal(stored.iso, 125);
    assert.equal(stored.place, 'Kyoto');
    assert.equal(stored.favorite, false);
    assert.equal(stored.keyId, 1);
    const ledger = queryGet<{ status: string; dirty: number }>(db, 'SELECT status, dirty FROM sync_ledger WHERE photo_id = ?', photo.id);
    assert.deepEqual(ledger, { status: 'local', dirty: 1 });
    db.close();
  });

  test('duplicate content hashes are rejected (dedup by construction)', () => {
    const { db, repo } = openSeeded();
    repo.insert(samplePhoto({ contentHash: 'same' }));
    assert.throws(() => repo.insert(samplePhoto({ contentHash: 'same' })), /UNIQUE/);
    db.close();
  });

  test('keyset pagination walks the full set in order without overlap', () => {
    const { db, repo } = openSeeded();
    for (let i = 0; i < 25; i += 1) {
      repo.insert(samplePhoto());
    }
    const seen: string[] = [];
    let cursor: { sortKey: string; id: string } | undefined;
    for (;;) {
      const page = repo.page({ source: 'all', limit: 7, ...(cursor ? { cursor } : {}) });
      seen.push(...page.photos.map((photo) => photo.id));
      if (page.nextCursor === null) {
        break;
      }
      cursor = page.nextCursor;
    }
    assert.equal(seen.length, 25);
    assert.equal(new Set(seen).size, 25);
    // Descending by sort key: first seen is the newest taken_at.
    const sortKeys = seen.map(
      (id) => queryGet<{ k: string }>(db, 'SELECT COALESCE(taken_at, imported_at) AS k FROM photos WHERE id = ?', id)?.k,
    );
    const sorted = [...sortKeys].sort().reverse();
    assert.deepEqual(sortKeys, sorted);
    db.close();
  });

  test('null taken_at falls back to imported_at in the sort', () => {
    const { db, repo } = openSeeded();
    repo.insert(samplePhoto({ takenAt: null, importedAt: '2026-07-10T00:00:00.000Z' }));
    repo.insert(samplePhoto({ takenAt: '2026-01-01T00:00:00.000Z' }));
    const page = repo.page({ source: 'all', limit: 10 });
    assert.equal(page.photos[0]?.takenAt, null);
    db.close();
  });

  test('favorite toggle flips state and dirties the ledger', () => {
    const { db, repo } = openSeeded();
    const photo = samplePhoto();
    repo.insert(photo);
    run(db, 'UPDATE sync_ledger SET dirty = 0 WHERE photo_id = ?', photo.id);
    assert.equal(repo.toggleFavorite(photo.id), true);
    assert.equal(repo.toggleFavorite(photo.id), false);
    assert.equal(queryGet<{ dirty: number }>(db, 'SELECT dirty FROM sync_ledger WHERE photo_id = ?', photo.id)?.dirty, 1);
    assert.throws(() => repo.toggleFavorite('missing'), /does not exist/);
    db.close();
  });

  test('FTS5 search index stays trigger-synced with photos', () => {
    const { db, repo } = openSeeded();
    const kyoto = samplePhoto({ place: 'Kyoto' });
    repo.insert(kyoto);
    repo.insert(samplePhoto({ place: 'Lisbon', camera: 'RICOH GR III' }));
    const hits = (q: string): number =>
      queryGet<{ n: number }>(db, 'SELECT count(*) AS n FROM photos_fts WHERE photos_fts MATCH ?', q)?.n ?? -1;
    assert.equal(hits('Kyoto'), 1);
    assert.equal(hits('RICOH'), 1);
    run(db, 'UPDATE photos SET place = ? WHERE id = ?', 'Osaka', kyoto.id);
    assert.equal(hits('Kyoto'), 0);
    assert.equal(hits('Osaka'), 1);
    run(db, 'DELETE FROM photos WHERE id = ?', kyoto.id);
    assert.equal(hits('Osaka'), 0);
    db.close();
  });

  test('counts by source match the sidebar vocabulary', () => {
    const { db, repo } = openSeeded();
    repo.insert(samplePhoto({ importedAt: '2026-07-11T00:00:00.000Z' }));
    repo.insert(samplePhoto({ favorite: true }));
    const offloaded = samplePhoto();
    repo.insert(offloaded);
    run(db, `UPDATE sync_ledger SET status = 'offloaded' WHERE photo_id = ?`, offloaded.id);
    const deleted = samplePhoto();
    repo.insert(deleted);
    run(db, `UPDATE photos SET deleted_at = ? WHERE id = ?`, '2026-07-12T00:00:00.000Z', deleted.id);

    assert.deepEqual(repo.counts('2026-07-10T00:00:00.000Z'), {
      all: 3,
      favorites: 1,
      recent: 1,
      offloaded: 1,
      deleted: 1,
    });
    db.close();
  });

  test('200K synthetic rows: one keyset page stays fast (baseline recorded)', () => {
    const { db, repo } = openSeeded();
    const insert = db.prepare(
      `INSERT INTO photos (id, file_name, file_kind, width, height, bytes, content_hash,
        imported_at, import_source, favorite, key_id, taken_at)
       VALUES (?, ?, 'jpeg', 6000, 4000, 8400000, ?, '2026-07-01T00:00:00.000Z', 'seed', 0, 1, ?)`,
    );
    db.transaction(() => {
      for (let i = 0; i < 200_000; i += 1) {
        const n = String(i).padStart(7, '0');
        insert.run(
          `01J8SEED${n}`,
          `IMG_${n}.JPG`,
          `seed-hash-${n}`,
          `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}T08:00:00.000Z`,
        );
      }
    })();

    const started = process.hrtime.bigint();
    const page = repo.page({ source: 'all', limit: 200 });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    assert.equal(page.photos.length, 200);
    assert.notEqual(page.nextCursor, null);
    // Baseline: keyset page over 200K rows. Budget formalizes in M11; this
    // bound only catches order-of-magnitude regressions (e.g. a lost index).
    assert.ok(elapsedMs < 250, `page query took ${elapsedMs.toFixed(1)}ms`);

    console.log(`[baseline] 200K keyset page: ${elapsedMs.toFixed(1)}ms`);
    db.close();
  });
});
