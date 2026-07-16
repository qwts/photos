import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, test } from 'node:test';

import { BlobStore } from '../../src/main/blobs/blob-store.js';
import { ProtectedBlobStore } from '../../src/main/blobs/protected-blob-store.js';
import {
  ProtectedPhotoMigrationService,
  ProtectedPhotoMigrationServiceError,
  type ProtectedMigrationAuthority,
} from '../../src/main/crypto/protected-photo-migration-service.js';
import { openProtectedPhotoMetadata } from '../../src/main/crypto/protected-photo-metadata.js';
import { openLibraryDatabase } from '../../src/main/db/database.js';
import { PhotosRepository } from '../../src/main/db/photos-repository.js';
import { ProtectedPhotoMigrationRepository } from '../../src/main/db/protected-photo-migration-repository.js';
import { run, runNamed } from '../../src/main/db/sql.js';

const LIBRARY_ID = 'library-a';
const PHOTO_ID = 'photo-a';

interface World {
  readonly dataDir: string;
  readonly db: ReturnType<typeof openLibraryDatabase>;
  readonly ordinary: BlobStore;
  readonly protected: ProtectedBlobStore;
  readonly photos: PhotosRepository;
  readonly migrations: ProtectedPhotoMigrationRepository;
  readonly service: ProtectedPhotoMigrationService;
  readonly libraryKey: Buffer;
  readonly albumKeyA: Buffer;
  readonly albumKeyB: Buffer;
  readonly contentHash: string;
  readonly protectAuthority: ProtectedMigrationAuthority;
  readonly manifestDebts: { count: number };
}

async function world(): Promise<World> {
  const dataDir = mkdtempSync(join(tmpdir(), 'overlook-protected-migration-'));
  const db = openLibraryDatabase({ path: join(dataDir, 'library.db'), dbKey: randomBytes(32) });
  const ordinary = new BlobStore({ dataDir });
  const protectedBlobs = new ProtectedBlobStore(dataDir);
  await ordinary.init();
  await protectedBlobs.init();
  const libraryKey = randomBytes(32);
  const albumKeyA = randomBytes(32);
  const albumKeyB = randomBytes(32);
  run(db, `INSERT INTO keys (id, wrapped_key, created_at) VALUES (1, 'wrapped', '2026-07-16T12:00:00.000Z')`);
  runNamed(db, `INSERT INTO albums (id, name, created_at, position) VALUES ('ordinary-a', 'Ordinary', @now, 0)`, {
    now: '2026-07-16T12:00:00.000Z',
  });
  for (const albumId of ['protected-a', 'protected-b']) {
    runNamed(
      db,
      `INSERT INTO protected_album_records (
         album_id, record_version, migration_state, credential_generation, metadata_generation,
         credential_record, sealed_metadata, created_at, updated_at
       ) VALUES (@albumId, 1, 'active', 1, 1, x'01', x'02', @now, @now)`,
      { albumId, now: '2026-07-16T12:00:00.000Z' },
    );
  }
  const original = Buffer.from('original secret bytes');
  const contentHash = createHash('sha256').update(original).digest('hex');
  await ordinary.putOriginal(Readable.from(original), { id: 1, key: libraryKey }, PHOTO_ID);
  await ordinary.putThumb(Readable.from('thumb bytes'), { id: 1, key: libraryKey }, PHOTO_ID, contentHash, 'thumb');
  await ordinary.putThumb(Readable.from('mid bytes'), { id: 1, key: libraryKey }, PHOTO_ID, contentHash, 'mid');
  const photos = new PhotosRepository(db);
  photos.insert({
    id: PHOTO_ID,
    fileName: 'secret.jpg',
    fileKind: 'jpeg',
    width: 10,
    height: 10,
    bytes: original.length,
    contentHash,
    camera: 'private camera',
    lens: null,
    iso: 100,
    aperture: '2.8',
    shutter: '1/250',
    focalLength: 35,
    takenAt: '2026-07-16T12:00:00.000Z',
    gpsLat: 1,
    gpsLon: 2,
    place: 'private place',
    importedAt: '2026-07-16T12:00:00.000Z',
    importSource: 'test',
    favorite: true,
    keyId: 1,
  });
  photos.addToAlbum('ordinary-a', [PHOTO_ID]);
  const migrations = new ProtectedPhotoMigrationRepository(db);
  const manifestDebts = { count: 0 };
  let sequence = 0;
  const service = new ProtectedPhotoMigrationService({
    libraryId: LIBRARY_ID,
    ordinaryBlobs: ordinary,
    protectedBlobs,
    photos,
    migrations,
    oweManifest: () => {
      manifestDebts.count += 1;
    },
    createMigrationId: () => `migration-${String(++sequence)}`,
  });
  return {
    dataDir,
    db,
    ordinary,
    protected: protectedBlobs,
    photos,
    migrations,
    service,
    libraryKey,
    albumKeyA,
    albumKeyB,
    contentHash,
    protectAuthority: { targetAlbumKey: albumKeyA, libraryResolver: (keyId) => (keyId === 1 ? libraryKey : undefined) },
    manifestDebts,
  };
}

async function bytes(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function protectedOriginalPath(dataDir: string): Promise<string> {
  const entries = await readdir(join(dataDir, 'protected-blobs'), { recursive: true, withFileTypes: true });
  const entry = entries.find((candidate) => candidate.isFile() && candidate.name.endsWith('.original'));
  assert.ok(entry !== undefined);
  return join(entry.parentPath, entry.name);
}

describe('ProtectedPhotoMigrationService', () => {
  test('protect then authorized unprotect round-trips bytes, derivatives, metadata, and memberships', async () => {
    const w = await world();
    const protectId = w.service.prepareProtect({ albumId: 'protected-a', albumKey: w.albumKeyA, photoIds: [PHOTO_ID] });
    await w.service.runToCompletion(protectId, w.protectAuthority);
    assert.equal(w.manifestDebts.count, 1, 'removing ordinary custody owes a fresh backup manifest');
    assert.equal(w.photos.get(PHOTO_ID), undefined);
    assert.equal(w.ordinary.hasOriginal(w.contentHash), false);
    const record = w.migrations.getProtected(PHOTO_ID)!;
    const metadata = openProtectedPhotoMetadata(
      { libraryId: LIBRARY_ID, albumId: 'protected-a', photoId: PHOTO_ID },
      w.albumKeyA,
      record.sealedMetadata,
    );
    assert.equal(metadata.photo.place, 'private place');
    assert.deepEqual(metadata.ordinaryMemberships, [{ albumId: 'ordinary-a', position: 0 }]);

    const unprotectId = w.service.prepareUnprotect({ albumId: 'protected-a', albumKey: w.albumKeyA, photoIds: [PHOTO_ID] });
    await w.service.runToCompletion(unprotectId, {
      sourceAlbumKey: w.albumKeyA,
      targetLibraryKey: { id: 1, key: w.libraryKey },
      libraryResolver: (keyId) => (keyId === 1 ? w.libraryKey : undefined),
    });
    assert.equal(w.photos.get(PHOTO_ID)?.place, 'private place');
    assert.deepEqual(w.photos.albumMembers('ordinary-a'), [PHOTO_ID]);
    assert.equal(
      (await bytes(w.ordinary.getStream(w.contentHash, (keyId) => (keyId === 1 ? w.libraryKey : undefined), PHOTO_ID))).toString(),
      'original secret bytes',
    );
    assert.equal(await w.ordinary.verifyThumbs(w.contentHash, (keyId) => (keyId === 1 ? w.libraryKey : undefined), PHOTO_ID), true);
    w.db.close();
  });

  test('startup repair safely handles every durable boundary', async () => {
    for (let advances = 0; advances <= 4; advances += 1) {
      const w = await world();
      const migrationId = w.service.prepareProtect({ albumId: 'protected-a', albumKey: w.albumKeyA, photoIds: [PHOTO_ID] });
      for (let step = 0; step < advances; step += 1) await w.service.advance(migrationId, w.protectAuthority);
      const phase = w.migrations.get(migrationId)?.phase;
      const debtBeforeRepair = w.manifestDebts.count;
      const repaired = await w.service.repairStartup();
      if (phase === 'commit' || phase === 'purge') {
        assert.deepEqual(repaired, { rolledBack: [], awaitingAuthority: [migrationId] });
        assert.equal(
          w.manifestDebts.count,
          debtBeforeRepair + 1,
          'restart reconstructs manifest debt after the ordinary row committed away',
        );
        assert.equal(w.ordinary.hasOriginal(w.contentHash), true);
        await w.service.runToCompletion(migrationId, w.protectAuthority);
        assert.equal(w.migrations.getProtected(PHOTO_ID)?.albumId, 'protected-a');
      } else {
        assert.deepEqual(repaired, { rolledBack: [migrationId], awaitingAuthority: [] });
        assert.equal(w.photos.get(PHOTO_ID)?.id, PHOTO_ID);
        assert.equal(w.ordinary.hasOriginal(w.contentHash), true);
      }
      w.db.close();
    }
  });

  test('protect retains shared ordinary blobs while another row owns the content hash', async () => {
    const w = await world();
    w.migrations.countOrdinaryBlobOwners = () => 1;
    const migrationId = w.service.prepareProtect({ albumId: 'protected-a', albumKey: w.albumKeyA, photoIds: [PHOTO_ID] });
    await w.service.runToCompletion(migrationId, w.protectAuthority);
    assert.equal(w.ordinary.hasOriginal(w.contentHash), true);
    assert.equal(await w.ordinary.verifyThumbs(w.contentHash, w.protectAuthority.libraryResolver!, PHOTO_ID), true);
    w.db.close();
  });

  test('corrupt destination never purges the last verified source; authorized move changes domains', async () => {
    const w = await world();
    const protectId = w.service.prepareProtect({ albumId: 'protected-a', albumKey: w.albumKeyA, photoIds: [PHOTO_ID] });
    for (let step = 0; step < 4; step += 1) await w.service.advance(protectId, w.protectAuthority);
    const targetPath = await protectedOriginalPath(w.dataDir);
    const encrypted = await readFile(targetPath);
    encrypted[encrypted.length - 1] = (encrypted.at(-1) ?? 0) ^ 1;
    await writeFile(targetPath, encrypted);
    await assert.rejects(w.service.advance(protectId, w.protectAuthority), ProtectedPhotoMigrationServiceError);
    assert.equal(w.ordinary.hasOriginal(w.contentHash), true);
    w.db.close();

    const moved = await world();
    const first = moved.service.prepareProtect({ albumId: 'protected-a', albumKey: moved.albumKeyA, photoIds: [PHOTO_ID] });
    await moved.service.runToCompletion(first, moved.protectAuthority);
    const sourceRef = moved.migrations.getProtected(PHOTO_ID)!.blobRef;
    const moveId = moved.service.prepareMove({
      sourceAlbumId: 'protected-a',
      sourceAlbumKey: moved.albumKeyA,
      targetAlbumId: 'protected-b',
      targetAlbumKey: moved.albumKeyB,
      photoIds: [PHOTO_ID],
    });
    await moved.service.runToCompletion(moveId, { sourceAlbumKey: moved.albumKeyA, targetAlbumKey: moved.albumKeyB });
    const target = moved.migrations.getProtected(PHOTO_ID)!;
    assert.equal(target.albumId, 'protected-b');
    assert.notEqual(target.blobRef, sourceRef);
    assert.equal(await moved.protected.verify('protected-b', target.blobRef, 'original', moved.albumKeyB, moved.contentHash), true);
    moved.db.close();
  });
});
