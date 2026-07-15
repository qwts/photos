import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { test } from 'node:test';

import { buildBackupManifestV2, type BackupManifestPhotoV2, type BackupManifestV2 } from '../../src/main/backup/backup-manifest.js';
import { FaultInjectingProvider, MockProvider } from '../../src/main/backup/mock-provider.js';
import type { ProviderAuthState, ProviderQuota, RemoteEntry, StorageProvider } from '../../src/main/backup/provider.js';
import { sealRecoveryBootstrap } from '../../src/main/backup/recovery-bootstrap.js';
import { RestoreEngine, type RestoreEngineDeps } from '../../src/main/backup/restore-engine.js';
import { RestoreError, type RestoreProgress } from '../../src/main/backup/restore-types.js';
import { BlobStore } from '../../src/main/blobs/blob-store.js';
import { createEncryptStream } from '../../src/main/crypto/envelope.js';
import { KeyStore, type SafeStorageLike } from '../../src/main/crypto/keystore.js';
import { openLibraryDatabase } from '../../src/main/db/database.js';
import { PhotosRepository } from '../../src/main/db/photos-repository.js';
import { queryGet } from '../../src/main/db/sql.js';
import { sampleJpeg } from '../../src/main/library/seed.js';

const LIBRARY_ID = '01JZZZZZZZZZZZZZZZZZZZZZZZ';
const GENERATED_AT = '2026-07-14T23:00:00.000Z';

const fakeSafeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8'),
  decryptString: (value) => value.toString('utf8'),
};

class CountingProvider implements StorageProvider {
  readonly capabilities;
  readonly id: string;
  readonly label: string;
  readonly gets: string[] = [];

  constructor(private readonly inner: StorageProvider) {
    this.capabilities = inner.capabilities;
    this.id = inner.id;
    this.label = inner.label;
  }

  authState(): Promise<ProviderAuthState> {
    return this.inner.authState();
  }

  put(path: string, bytes: Readable): Promise<{ bytes: number }> {
    return this.inner.put(path, bytes);
  }

  getStream(path: string): Promise<Readable> {
    this.gets.push(path);
    return this.inner.getStream(path);
  }

  list(prefix: string): Promise<readonly RemoteEntry[]> {
    return this.inner.list(prefix);
  }

  delete(path: string): Promise<void> {
    return this.inner.delete(path);
  }

  quota(): Promise<ProviderQuota> {
    return this.inner.quota();
  }

  verify(path: string): Promise<{ sha256: string; bytes: number }> {
    return this.inner.verify(path);
  }
}

interface RestoreWorld {
  readonly provider: MockProvider;
  readonly counting: CountingProvider;
  readonly keyStore: KeyStore;
  readonly masterKey: Buffer;
  readonly targetDir: string;
  readonly photos: readonly BackupManifestPhotoV2[];
  readonly plaintextById: ReadonlyMap<string, Buffer>;
  readonly progress: RestoreProgress[];
  readonly deps: RestoreEngineDeps;
}

async function put(provider: StorageProvider, path: string, bytes: Buffer): Promise<void> {
  await provider.put(path, Readable.from([bytes]));
}

async function sealManifest(value: unknown, keyStore: KeyStore): Promise<Buffer> {
  return buffer(
    Readable.from([Buffer.from(JSON.stringify(value))]).pipe(createEncryptStream(keyStore.currentKey(), { photoId: 'manifest' })),
  );
}

function makeManifest(photos: readonly BackupManifestPhotoV2[]): BackupManifestV2 {
  return buildBackupManifestV2({
    libraryId: LIBRARY_ID,
    generatedAt: GENERATED_AT,
    snapshot: {
      databaseSchema: 3,
      keyIds: [1],
      totals: { photos: photos.length, bytes: photos.reduce((sum, photo) => sum + photo.bytes, 0), albums: 1 },
      photos,
      albums: [
        {
          id: 'A1',
          name: 'Recovered',
          createdAt: GENERATED_AT,
          position: 0,
          photoIds: photos.map((photo) => photo.id),
        },
      ],
    },
  });
}

async function restoreWorld(count = 1): Promise<RestoreWorld> {
  const sourceDir = mkdtempSync(join(tmpdir(), 'overlook-restore-source-'));
  const targetDir = join(mkdtempSync(join(tmpdir(), 'overlook-restore-target-')), 'library');
  const keyStore = KeyStore.open({ safeStorage: fakeSafeStorage, dataDir: sourceDir });
  const masterKey = keyStore.masterKeyBytes();
  const sourceStore = new BlobStore({ dataDir: sourceDir });
  await sourceStore.init();
  const plaintextById = new Map<string, Buffer>();
  const photos: BackupManifestPhotoV2[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = `P${String(index + 1)}`;
    const bytes = sampleJpeg(index + 1);
    plaintextById.set(id, bytes);
    const ref = await sourceStore.putOriginal(Readable.from([bytes]), keyStore.currentKey(), id);
    photos.push({
      id,
      fileName: `IMG_${String(index + 1)}.JPG`,
      fileKind: 'jpeg',
      width: 1,
      height: 1,
      bytes: ref.bytes,
      contentHash: ref.contentHash,
      blobPath: `blobs/${ref.contentHash.slice(0, 2)}/${ref.contentHash}`,
      camera: 'Recovered Camera',
      lens: null,
      iso: 100,
      aperture: null,
      shutter: null,
      focalLength: null,
      takenAt: null,
      gpsLat: null,
      gpsLon: null,
      place: null,
      importedAt: `2026-07-14T23:00:0${String(index)}.000Z`,
      importSource: 'cloud-restore',
      favorite: index === 0,
      keyId: ref.keyId,
      deletedAt: null,
    });
  }
  const provider = new MockProvider({ rootDir: mkdtempSync(join(tmpdir(), 'overlook-restore-remote-')) });
  for (const photo of photos) await put(provider, photo.blobPath, await buffer(sourceStore.getEncryptedStream(photo.contentHash)));
  await put(
    provider,
    'recovery/bootstrap.ovrb',
    sealRecoveryBootstrap({ schema: 1, libraryId: LIBRARY_ID, generatedAt: GENERATED_AT, keys: keyStore.exportWrappedKeys() }, masterKey),
  );
  await put(provider, 'manifest/gen-1.ovlk', await sealManifest(makeManifest(photos), keyStore));
  const counting = new CountingProvider(provider);
  const progress: RestoreProgress[] = [];
  const deps: RestoreEngineDeps = {
    provider: counting,
    targetDir,
    safeStorage: fakeSafeStorage,
    availableBytes: () => Promise.resolve(Number.MAX_SAFE_INTEGER),
    thumbnails: (store) => ({
      generateFor: async (request) => {
        await store.putThumb(
          Readable.from([Buffer.from(`thumb:${request.photoId}`)]),
          request.key,
          request.photoId,
          request.contentHash,
          'thumb',
        );
        await store.putThumb(
          Readable.from([Buffer.from(`mid:${request.photoId}`)]),
          request.key,
          request.photoId,
          request.contentHash,
          'mid',
        );
        return { generated: true, width: 1, height: 1 };
      },
    }),
    events: { progress: (value) => progress.push(value) },
  };
  return { provider, counting, keyStore, masterKey, targetDir, photos, plaintextById, progress, deps };
}

function isReason(reason: RestoreError['reason']): (error: unknown) => boolean {
  return (error) => error instanceof RestoreError && error.reason === reason;
}

test('restore engine: fresh staging rebuilds keys, catalog, originals, thumbnails, and albums before activation (#288)', async () => {
  const world = await restoreWorld(2);
  const result = await new RestoreEngine(world.deps).run({ masterKey: world.masterKey, allowReplace: false });
  assert.deepEqual(result, { libraryId: LIBRARY_ID, generation: 1, photos: 2, resumed: false });
  assert.equal(existsSync(`${world.targetDir}.restore-staging`), false);
  assert.equal(existsSync(`${world.targetDir}.restore-previous`), false);

  const restoredKeys = KeyStore.open({ safeStorage: fakeSafeStorage, dataDir: world.targetDir });
  const dbKey = restoredKeys.resolver()(1);
  assert.ok(dbKey !== undefined);
  const db = openLibraryDatabase({ path: join(world.targetDir, 'library.db'), dbKey });
  const repo = new PhotosRepository(db);
  assert.deepEqual(repo.albums(), [{ id: 'A1', name: 'Recovered', count: 2 }]);
  assert.equal(repo.pendingCount(), 0);
  assert.equal(queryGet<{ count: number }>(db, 'SELECT count(*) AS count FROM photos_fts')?.count, 2);
  db.close();

  const restoredStore = new BlobStore({ dataDir: world.targetDir });
  await restoredStore.init();
  for (const photo of world.photos) {
    assert.deepEqual(
      await buffer(restoredStore.getStream(photo.contentHash, restoredKeys.resolver(), photo.id)),
      world.plaintextById.get(photo.id),
    );
    assert.equal(await restoredStore.verifyThumbs(photo.contentHash, restoredKeys.resolver(), photo.id), true);
  }
  assert.equal(world.progress.at(-1)?.stage, 'complete');
});

test('restore engine: corrupt newest-generation blob falls back without contaminating the previous generation (#288)', async () => {
  const world = await restoreWorld();
  const badHash = 'cd'.repeat(32);
  const first = world.photos[0];
  assert.ok(first !== undefined);
  const newestPhoto: BackupManifestPhotoV2 = { ...first, id: 'P-new', contentHash: badHash, blobPath: `blobs/cd/${badHash}` };
  await put(world.provider, newestPhoto.blobPath, Buffer.from('not an envelope'));
  await put(world.provider, 'manifest/gen-2.ovlk', await sealManifest(makeManifest([newestPhoto]), world.keyStore));

  const result = await new RestoreEngine(world.deps).run({ masterKey: world.masterKey, allowReplace: false });
  assert.equal(result.generation, 1);
  const restoredKeys = KeyStore.open({ safeStorage: fakeSafeStorage, dataDir: world.targetDir });
  const restoredStore = new BlobStore({ dataDir: world.targetDir });
  await restoredStore.init();
  const original = world.photos[0];
  assert.ok(original !== undefined);
  assert.equal(await restoredStore.verifyOriginal(original.contentHash, restoredKeys.resolver(), original.id), true);
  assert.equal(restoredStore.hasOriginal(badHash), false);
});

test('restore engine: cancellation checkpoints blobs and resumes without redownloading (#288)', async () => {
  const world = await restoreWorld(2);
  const controller = new AbortController();
  const cancelDeps: RestoreEngineDeps = {
    ...world.deps,
    events: {
      progress: (value) => {
        world.progress.push(value);
        if (value.stage === 'downloading' && value.done === 1) controller.abort();
      },
    },
  };
  await assert.rejects(
    new RestoreEngine(cancelDeps).run({ masterKey: world.masterKey, allowReplace: false, signal: controller.signal }),
    isReason('cancelled'),
  );
  const result = await new RestoreEngine(world.deps).run({ masterKey: world.masterKey, allowReplace: false });
  assert.equal(result.resumed, true);
  for (const photo of world.photos) {
    assert.equal(
      world.counting.gets.filter((path) => path === photo.blobPath).length,
      1,
      `${photo.id} ciphertext should download exactly once`,
    );
  }
});

test('restore engine: non-empty targets require destructive authorization before remote reads (#288)', async () => {
  const world = await restoreWorld();
  mkdirSync(world.targetDir);
  writeFileSync(join(world.targetDir, 'existing'), 'keep me', { flag: 'wx' });
  const before = world.counting.gets.length;
  await assert.rejects(
    new RestoreEngine(world.deps).run({ masterKey: world.masterKey, allowReplace: false }),
    isReason('destructive-authorization'),
  );
  assert.equal(world.counting.gets.length, before);
  assert.equal(await readFile(join(world.targetDir, 'existing'), 'utf8'), 'keep me');
});

test('restore engine: disk preflight fails before downloading any referenced blob (#288)', async () => {
  const world = await restoreWorld();
  const noSpaceDeps: RestoreEngineDeps = { ...world.deps, availableBytes: () => Promise.resolve(0) };
  await assert.rejects(new RestoreEngine(noSpaceDeps).run({ masterKey: world.masterKey, allowReplace: false }), isReason('disk-space'));
  assert.equal(world.counting.gets.filter((path) => path.startsWith('blobs/')).length, 0);
  assert.equal(existsSync(world.targetDir), false);
});

test('restore engine: explicit authorization atomically replaces a non-empty library (#288)', async () => {
  const world = await restoreWorld();
  mkdirSync(world.targetDir);
  writeFileSync(join(world.targetDir, 'existing'), 'replace me');
  await new RestoreEngine(world.deps).run({ masterKey: world.masterKey, allowReplace: true });
  assert.equal(existsSync(join(world.targetDir, 'existing')), false);
  assert.equal(existsSync(join(world.targetDir, 'library.db')), true);
  assert.equal(existsSync(`${world.targetDir}.restore-previous`), false);
});

test('restore engine: provider authentication and offline failures retain typed reasons (#288)', async () => {
  const authWorld = await restoreWorld();
  authWorld.provider.setConnected(false);
  await assert.rejects(new RestoreEngine(authWorld.deps).run({ masterKey: authWorld.masterKey, allowReplace: false }), isReason('auth'));

  const offlineWorld = await restoreWorld();
  const faulty = new FaultInjectingProvider(offlineWorld.counting);
  faulty.arm('transient-get');
  const offlineDeps: RestoreEngineDeps = { ...offlineWorld.deps, provider: faulty };
  await assert.rejects(new RestoreEngine(offlineDeps).run({ masterKey: offlineWorld.masterKey, allowReplace: false }), isReason('offline'));
});
