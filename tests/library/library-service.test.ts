import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openLibraryDatabase } from '../../src/main/db/database.js';
import { run } from '../../src/main/db/sql.js';
import { LibraryService } from '../../src/main/library/library-service.js';
import { channels } from '../../src/shared/ipc/channels.js';
import { createInvoker, wrapHandler } from '../../src/shared/ipc/registry.js';
import type { PhotoInsert } from '../../src/shared/library/types.js';
import { PhotosRepository } from '../../src/main/db/photos-repository.js';

// Contract tests (#71): the renderer-side invoker talks to the wrapped main
// handlers over a fake transport — both directions schema-validated — against
// a seeded temp library shaped like the design mock's data.

function seededService(): {
  service: LibraryService;
  events: { changed: string[][]; pending: number[] };
} {
  const db = openLibraryDatabase({
    path: join(mkdtempSync(join(tmpdir(), 'overlook-lib-')), 'library.db'),
    dbKey: randomBytes(32),
  });
  run(db, `INSERT INTO keys (id, wrapped_key, created_at) VALUES (1, 'w', ?)`, '2026-07-01T00:00:00Z');
  const repo = new PhotosRepository(db);

  // Mock-shaped seed (ui_kits photos.js): every 5th is RAW, places rotate,
  // some favorites, one offloaded, one deleted.
  const cams = ['FUJIFILM X-T5', 'SONY A7 IV', 'APPLE iPHONE 15 PRO', 'RICOH GR III'];
  const places = ['Lisbon', 'Big Sur', 'Kyoto', 'Home'];
  const inserts: PhotoInsert[] = [];
  for (let i = 0; i < 20; i += 1) {
    const n = String(i).padStart(3, '0');
    inserts.push({
      id: `01J8LIB${n}`,
      fileName: `IMG_${String(4021 + i * 7)}${i % 5 === 0 ? '.RAF' : '.JPG'}`,
      fileKind: i % 5 === 0 ? 'raw' : 'jpeg',
      width: 6240,
      height: 4160,
      bytes: 8_400_000,
      contentHash: `hash-${n}`,
      camera: cams[i % 4] ?? null,
      lens: null,
      iso: 125,
      aperture: '1.8',
      shutter: '1/250',
      focalLength: 23,
      takenAt: `2026-06-${String((i % 27) + 1).padStart(2, '0')}T12:00:00.000Z`,
      gpsLat: null,
      gpsLon: null,
      place: places[i % 4] ?? null,
      importedAt: '2026-07-01T00:00:00.000Z',
      importSource: 'sd-card',
      favorite: i % 9 === 0,
      keyId: 1,
    });
  }
  for (const photo of inserts) {
    repo.insert(photo);
  }
  run(db, `UPDATE sync_ledger SET status = 'offloaded', dirty = 0 WHERE photo_id = '01J8LIB003'`);
  run(db, `UPDATE sync_ledger SET status = 'synced', dirty = 0 WHERE photo_id = '01J8LIB004'`);
  run(db, `UPDATE photos SET deleted_at = '2026-07-02T00:00:00Z' WHERE id = '01J8LIB005'`);

  const events = { changed: [] as string[][], pending: [] as number[] };
  const service = new LibraryService(db, {
    libraryChanged: (ids) => events.changed.push([...ids]),
    pendingCountChanged: (count) => events.pending.push(count),
  });
  return { service, events };
}

// A "renderer": invokers over a transport that calls the wrapped handlers,
// so malformed traffic in either direction rejects exactly as over IPC.
function rendererClient(service: LibraryService): {
  page: ReturnType<typeof createInvoker<typeof channels.libraryPage.request, typeof channels.libraryPage.response>>;
  toggleFavorite: ReturnType<
    typeof createInvoker<typeof channels.libraryToggleFavorite.request, typeof channels.libraryToggleFavorite.response>
  >;
  stats: ReturnType<typeof createInvoker<typeof channels.libraryStats.request, typeof channels.libraryStats.response>>;
} {
  const handlers: Record<string, (request: unknown) => Promise<unknown>> = {
    [channels.libraryPage.name]: wrapHandler(channels.libraryPage, (req) => service.page(req)),
    [channels.libraryToggleFavorite.name]: wrapHandler(channels.libraryToggleFavorite, ({ id }) => service.toggleFavorite(id)),
    [channels.libraryStats.name]: wrapHandler(channels.libraryStats, () => service.stats()),
  };
  const transport = (name: string, request: unknown): Promise<unknown> => {
    const handler = handlers[name];
    if (handler === undefined) {
      return Promise.reject(new Error(`no handler for ${name}`));
    }
    return handler(request);
  };
  return {
    page: createInvoker(channels.libraryPage, transport),
    toggleFavorite: createInvoker(channels.libraryToggleFavorite, transport),
    stats: createInvoker(channels.libraryStats, transport),
  };
}

describe('library IPC contract', () => {
  test('pages through the seeded library like the mock visible derivation', async () => {
    const { service } = seededService();
    const client = rendererClient(service);

    // All: 19 live photos (one deleted), newest taken_at first.
    const all = await client.page({ source: 'all', limit: 50 });
    assert.equal(all.photos.length, 19);

    // Chips AND-combine: raw + favorites.
    const rawFavorites = await client.page({
      source: 'all',
      limit: 50,
      chips: { raw: true, favorites: true },
    });
    for (const photo of rawFavorites.photos) {
      assert.equal(photo.fileKind, 'raw');
      assert.equal(photo.favorite, true);
    }
    // raw ∩ favorites in the seed: only i=0 (raw at 0,5,10,15; favorite at 0,9,18).
    assert.equal(rawFavorites.photos.length, 1);

    // Search: case-insensitive substring across name/place/camera.
    const kyoto = await client.page({ source: 'all', limit: 50, query: 'kyo' });
    assert.ok(kyoto.photos.length > 0);
    for (const photo of kyoto.photos) {
      assert.equal(photo.place, 'Kyoto');
    }
    const ricoh = await client.page({ source: 'all', limit: 50, query: 'ricoh' });
    assert.ok(ricoh.photos.every((photo) => photo.camera === 'RICOH GR III'));

    // Offloaded chip.
    const offloaded = await client.page({ source: 'all', limit: 50, chips: { offloaded: true } });
    assert.deepEqual(
      offloaded.photos.map((photo) => photo.id),
      ['01J8LIB003'],
    );

    // Local-only excludes offloaded/synced.
    const local = await client.page({ source: 'all', limit: 50, chips: { localOnly: true } });
    assert.equal(local.photos.length, 17);
  });

  test('malformed requests and responses reject at the boundary', async () => {
    const { service } = seededService();
    const client = rendererClient(service);
    // limit over the schema cap never reaches the service.
    await assert.rejects(client.page({ source: 'all', limit: 5000 }));
    // Unknown source enum rejects.
    await assert.rejects(client.page({ source: 'everything' as never, limit: 10 }));
  });

  test('favorite toggle bumps pendingCount and emits both events', async () => {
    const { service, events } = seededService();
    const client = rendererClient(service);
    const before = service.pendingCount(); // 18 dirty from seeding (2 cleared)

    const result = await client.toggleFavorite({ id: '01J8LIB004' });
    assert.equal(result.favorite, true);
    assert.equal(result.pendingCount, before + 1);
    assert.deepEqual(events.changed.at(-1), ['01J8LIB004']);
    assert.equal(events.pending.at(-1), before + 1);
  });

  test('stats reports live photo count and bytes for the StatusBar', async () => {
    const { service } = seededService();
    const client = rendererClient(service);
    const stats = await client.stats({});
    assert.equal(stats.photos, 19);
    assert.equal(stats.bytes, 19 * 8_400_000);
  });
});
