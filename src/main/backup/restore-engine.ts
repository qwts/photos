import { isDeepStrictEqual } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { addAbortSignal } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { BlobStore, BlobStoreError } from '../blobs/blob-store.js';
import { ProtectedBlobStore, ProtectedBlobStoreError } from '../blobs/protected-blob-store.js';
import { KeyStore, type SafeStorageLike } from '../crypto/keystore.js';
import { installRecoveredMaster } from '../crypto/recovery.js';
import { openLibraryDatabase } from '../db/database.js';
import { PhotosRepository } from '../db/photos-repository.js';
import { boardsSnapshot, restoreBoards } from '../db/board-repository.js';
import { ProtectedRecoveryRepository } from '../db/protected-recovery-repository.js';
import { ActivityRepository } from '../activity/activity-repository.js';
import type { ThumbnailService } from '../import/thumbnail-service.js';
import type { BackupManifestPhotoV2 } from './backup-manifest.js';
import { discoverRestore, type RestoreCandidate, type RestoreDiscovery } from './restore-discovery.js';
import {
  activateStagedLibrary,
  assertRestoreAuthorized,
  loadCheckpoint,
  recoverInterruptedActivation,
  resetStaging,
  restorePaths,
  saveCheckpoint,
  type ActivationOperations,
  type RestorePaths,
} from './restore-staging.js';
import { RestoreError, toRestoreError, type RestoreCheckpoint, type RestoreProgress } from './restore-types.js';
import type { StorageProvider } from './provider.js';

const SCRATCH_BYTES = 16 * 1024 * 1024;

export interface RestoreEngineDeps {
  readonly provider: StorageProvider;
  readonly targetDir: string;
  readonly safeStorage: SafeStorageLike;
  readonly thumbnails: (store: BlobStore) => Pick<ThumbnailService, 'generateFor'>;
  readonly availableBytes?: ((path: string) => Promise<number>) | undefined;
  readonly activationOperations?: ActivationOperations | undefined;
  readonly beforeActivate?: (() => Promise<void>) | undefined;
  readonly events: { progress(progress: RestoreProgress): void };
}

export interface RestoreRequest {
  readonly masterKey: Buffer;
  readonly allowReplace: boolean;
  readonly signal?: AbortSignal | undefined;
}

export interface RestoreRunResult {
  readonly libraryId: string;
  readonly generation: number;
  readonly photos: number;
  readonly resumed: boolean;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new RestoreError('cancelled', 'restore cancelled');
}

function checkpointFor(discovery: RestoreDiscovery, candidate: RestoreCandidate): RestoreCheckpoint {
  return {
    version: 1,
    libraryId: discovery.bootstrap.libraryId,
    manifestPath: candidate.path,
    sealedManifestSha256: candidate.sealedSha256,
    completedBlobIds: [],
    completedThumbnailIds: [],
    completedProtectedObjectIds: [],
  };
}

function checkpointMatches(checkpoint: RestoreCheckpoint, discovery: RestoreDiscovery, candidate: RestoreCandidate): boolean {
  return (
    checkpoint.libraryId === discovery.bootstrap.libraryId &&
    checkpoint.manifestPath === candidate.path &&
    checkpoint.sealedManifestSha256 === candidate.sealedSha256
  );
}

async function defaultAvailableBytes(path: string): Promise<number> {
  const info = await statfs(path);
  return Number(info.bavail) * Number(info.bsize);
}

export class RestoreEngine {
  constructor(private readonly deps: RestoreEngineDeps) {}

  async run(request: RestoreRequest): Promise<RestoreRunResult> {
    const paths = restorePaths(this.deps.targetDir);
    try {
      await mkdir(dirname(paths.targetDir), { recursive: true });
      await recoverInterruptedActivation(paths);
      await assertRestoreAuthorized(paths, request.allowReplace);
      if (!this.deps.safeStorage.isEncryptionAvailable()) {
        throw new RestoreError('io', 'OS keychain is unavailable; restored master key cannot be protected');
      }
      this.emit('discovering', 0, 0, null);
      const discovery = await discoverRestore(this.deps.provider, request.masterKey, request.signal);
      let lastCandidateError: RestoreError | null = null;
      for (const candidate of discovery.candidates) {
        try {
          return await this.restoreCandidate(paths, discovery, candidate, request);
        } catch (error) {
          const mapped = toRestoreError(error);
          if (mapped.reason !== 'corrupt' && mapped.reason !== 'unsupported') throw mapped;
          lastCandidateError = mapped;
        }
      }
      throw lastCandidateError ?? new RestoreError('corrupt', 'no manifest generation could be restored');
    } catch (error) {
      throw toRestoreError(error);
    }
  }

  private async restoreCandidate(
    paths: RestorePaths,
    discovery: RestoreDiscovery,
    candidate: RestoreCandidate,
    request: RestoreRequest,
  ): Promise<RestoreRunResult> {
    const loaded = await loadCheckpoint(paths);
    let checkpoint: RestoreCheckpoint;
    let resumed = false;
    if (loaded !== null && checkpointMatches(loaded, discovery, candidate)) {
      checkpoint = loaded;
      resumed =
        loaded.completedBlobIds.length > 0 || loaded.completedThumbnailIds.length > 0 || loaded.completedProtectedObjectIds.length > 0;
    } else {
      await resetStaging(paths);
      checkpoint = checkpointFor(discovery, candidate);
      await saveCheckpoint(paths, checkpoint);
    }
    const store = new BlobStore({ dataDir: paths.stagingDir });
    const protectedStore = new ProtectedBlobStore(paths.stagingDir);
    await store.init();
    await protectedStore.init();
    checkpoint = await this.restoreBlobs(paths, store, discovery, candidate, checkpoint, request.signal);
    checkpoint = await this.restoreProtectedBlobs(paths, protectedStore, candidate, checkpoint, request.signal);
    const recoveredKeys = await this.prepareRecoveredCustody(paths, discovery, candidate, request.masterKey);
    try {
      await this.restoreThumbnails(paths, store, recoveredKeys, discovery, candidate, checkpoint, request.signal);
      this.emit('rebuilding', 0, candidate.manifest.photos.length, null);
      await this.rebuildCatalog(paths, store, protectedStore, discovery, candidate);
    } finally {
      recoveredKeys.close();
    }
    assertNotAborted(request.signal);
    this.emit('activating', 0, 1, null);
    await this.deps.beforeActivate?.();
    await activateStagedLibrary(paths, this.deps.activationOperations);
    await rm(join(paths.targetDir, 'restore-checkpoint.json'), { force: true });
    this.emit('complete', 1, 1, null);
    return {
      libraryId: candidate.manifest.libraryId,
      generation: candidate.generation,
      photos: candidate.manifest.photos.length,
      resumed,
    };
  }

  private async restoreProtectedBlobs(
    paths: RestorePaths,
    store: ProtectedBlobStore,
    candidate: RestoreCandidate,
    checkpoint: RestoreCheckpoint,
    signal?: AbortSignal,
  ): Promise<RestoreCheckpoint> {
    if (candidate.manifest.schema === 2) return checkpoint;
    const entries = candidate.manifest.protectedPhotos.flatMap((photo) =>
      photo.objects.filter((object) => object.status === 'synced').map((object) => ({ photo, object, id: `${photo.id}:${object.kind}` })),
    );
    const ids = new Set(entries.map((entry) => entry.id));
    const completed = new Set(checkpoint.completedProtectedObjectIds.filter((id) => ids.has(id)));
    for (const entry of entries) {
      if (!completed.has(entry.id)) continue;
      if (!store.has(entry.photo.albumId, entry.photo.blobRef, entry.object.kind)) {
        completed.delete(entry.id);
        continue;
      }
      const actual = await store.ciphertextInfo(entry.photo.albumId, entry.photo.blobRef, entry.object.kind);
      if (actual.sha256 !== entry.object.sha256 || actual.bytes !== entry.object.bytes) {
        completed.delete(entry.id);
        await store.deleteKind(entry.photo.albumId, entry.photo.blobRef, entry.object.kind);
      }
    }
    checkpoint = { ...checkpoint, completedProtectedObjectIds: [...completed] };
    await saveCheckpoint(paths, checkpoint);
    const pending = entries.filter((entry) => !completed.has(entry.id));
    const requiredBytes = SCRATCH_BYTES + pending.reduce((sum, entry) => sum + entry.object.bytes, 0);
    const available = await (this.deps.availableBytes ?? defaultAvailableBytes)(dirname(paths.targetDir));
    if (available < requiredBytes) {
      throw new RestoreError('disk-space', `restore needs ${String(requiredBytes)} bytes but only ${String(available)} are available`);
    }
    let done = completed.size;
    this.emit('downloading', done, entries.length, null);
    for (const entry of pending) {
      assertNotAborted(signal);
      try {
        const remote = await this.deps.provider.getStream(entry.object.path);
        await store.restoreEncrypted({
          albumId: entry.photo.albumId,
          blobRef: entry.photo.blobRef,
          kind: entry.object.kind,
          ciphertext: signal === undefined ? remote : addAbortSignal(signal, remote),
          sha256: entry.object.sha256,
          bytes: entry.object.bytes,
        });
      } catch (error) {
        if (error instanceof ProtectedBlobStoreError) throw new RestoreError('corrupt', error.message);
        throw error;
      }
      completed.add(entry.id);
      checkpoint = { ...checkpoint, completedProtectedObjectIds: [...completed] };
      await saveCheckpoint(paths, checkpoint);
      this.emit('downloading', ++done, entries.length, null);
    }
    return checkpoint;
  }

  private async restoreBlobs(
    paths: RestorePaths,
    store: BlobStore,
    discovery: RestoreDiscovery,
    candidate: RestoreCandidate,
    checkpoint: RestoreCheckpoint,
    signal?: AbortSignal,
  ): Promise<RestoreCheckpoint> {
    const manifestIds = new Set(candidate.manifest.photos.map((photo) => photo.id));
    const completed = new Set(checkpoint.completedBlobIds.filter((id) => manifestIds.has(id)));
    for (const photo of candidate.manifest.photos) {
      if (completed.has(photo.id) && !(await store.verifyOriginal(photo.contentHash, discovery.resolveKey, photo.id))) {
        completed.delete(photo.id);
        await store.deleteOriginal(photo.contentHash);
      }
    }
    checkpoint = { ...checkpoint, completedBlobIds: [...completed] };
    await saveCheckpoint(paths, checkpoint);
    const remote = new Map((await this.deps.provider.list('blobs')).map((entry) => [entry.path, entry]));
    const pending = candidate.manifest.photos.filter((photo) => !completed.has(photo.id));
    let requiredBytes = SCRATCH_BYTES;
    for (const photo of pending) {
      const entry = remote.get(photo.blobPath);
      if (entry === undefined) throw new RestoreError('corrupt', `manifest references missing ${photo.blobPath}`);
      requiredBytes += entry.bytes;
    }
    const available = await (this.deps.availableBytes ?? defaultAvailableBytes)(dirname(paths.targetDir));
    if (available < requiredBytes) {
      throw new RestoreError('disk-space', `restore needs ${String(requiredBytes)} bytes but only ${String(available)} are available`);
    }
    let done = completed.size;
    this.emit('downloading', done, candidate.manifest.photos.length, null);
    for (const photo of pending) {
      assertNotAborted(signal);
      try {
        const remoteStream = await this.deps.provider.getStream(photo.blobPath);
        await store.restoreOriginal(
          photo.contentHash,
          signal === undefined ? remoteStream : addAbortSignal(signal, remoteStream),
          discovery.resolveKey,
          photo.id,
        );
      } catch (error) {
        if (error instanceof BlobStoreError) throw new RestoreError('corrupt', error.message);
        throw error;
      }
      completed.add(photo.id);
      done += 1;
      checkpoint = { ...checkpoint, completedBlobIds: [...completed] };
      await saveCheckpoint(paths, checkpoint);
      this.emit('downloading', done, candidate.manifest.photos.length, photo.id);
    }
    return checkpoint;
  }

  private async restoreThumbnails(
    paths: RestorePaths,
    store: BlobStore,
    recoveredKeys: KeyStore,
    discovery: RestoreDiscovery,
    candidate: RestoreCandidate,
    checkpoint: RestoreCheckpoint,
    signal?: AbortSignal,
  ): Promise<RestoreCheckpoint> {
    const thumbnails = this.deps.thumbnails(store);
    const manifestIds = new Set(candidate.manifest.photos.map((photo) => photo.id));
    const completed = new Set(checkpoint.completedThumbnailIds.filter((id) => manifestIds.has(id)));
    for (const photo of candidate.manifest.photos) {
      if (completed.has(photo.id) && !(await store.verifyThumbs(photo.contentHash, discovery.resolveKey, photo.id))) {
        completed.delete(photo.id);
        await store.deleteThumbs(photo.contentHash);
      }
    }
    let done = completed.size;
    this.emit('rebuilding', done, candidate.manifest.photos.length, null);
    for (const photo of candidate.manifest.photos.filter((item) => !completed.has(item.id))) {
      assertNotAborted(signal);
      await this.generateThumbnails(thumbnails, store, recoveredKeys, discovery, photo, signal);
      completed.add(photo.id);
      done += 1;
      checkpoint = { ...checkpoint, completedThumbnailIds: [...completed] };
      await saveCheckpoint(paths, checkpoint);
      this.emit('rebuilding', done, candidate.manifest.photos.length, photo.id);
    }
    return checkpoint;
  }

  private async generateThumbnails(
    thumbnails: Pick<ThumbnailService, 'generateFor'>,
    store: BlobStore,
    recoveredKeys: KeyStore,
    discovery: RestoreDiscovery,
    photo: BackupManifestPhotoV2,
    signal?: AbortSignal,
  ): Promise<void> {
    const plaintext = await buffer(
      signal === undefined
        ? store.getStream(photo.contentHash, discovery.resolveKey, photo.id)
        : addAbortSignal(signal, store.getStream(photo.contentHash, discovery.resolveKey, photo.id)),
    );
    try {
      await thumbnails.generateFor({
        photoId: photo.id,
        bytes: plaintext,
        contentHash: photo.contentHash,
        key: recoveredKeys.currentKey(),
        fileKind: photo.fileKind,
        signal,
      });
    } finally {
      plaintext.fill(0);
    }
  }

  private async prepareRecoveredCustody(
    paths: RestorePaths,
    discovery: RestoreDiscovery,
    candidate: RestoreCandidate,
    masterKey: Buffer,
  ): Promise<KeyStore> {
    const libraryIdPath = join(paths.stagingDir, 'library-id');
    await writeFile(`${libraryIdPath}.tmp`, candidate.manifest.libraryId);
    await rename(`${libraryIdPath}.tmp`, libraryIdPath);
    const keysPath = join(paths.stagingDir, 'keys.json');
    if (!existsSync(keysPath)) {
      const temporaryKeysPath = `${keysPath}.tmp`;
      await writeFile(temporaryKeysPath, JSON.stringify({ version: 1, keys: discovery.bootstrap.keys }, null, 2));
      await rename(temporaryKeysPath, keysPath);
    }
    const installed = installRecoveredMaster(paths.stagingDir, this.deps.safeStorage, masterKey);
    if (installed !== 'installed' && installed !== 'already-installed') {
      throw new RestoreError('wrong-key', `recovered master installation failed: ${installed}`);
    }
    return KeyStore.open({ safeStorage: this.deps.safeStorage, dataDir: paths.stagingDir });
  }

  private async rebuildCatalog(
    paths: RestorePaths,
    store: BlobStore,
    protectedStore: ProtectedBlobStore,
    discovery: RestoreDiscovery,
    candidate: RestoreCandidate,
  ): Promise<void> {
    const dbKey = discovery.resolveKey(1);
    if (dbKey === undefined) throw new RestoreError('wrong-key', 'recovery bootstrap does not contain database key #1');
    const dbPath = join(paths.stagingDir, 'library.db');
    for (const suffix of ['', '-wal', '-shm']) await rm(`${dbPath}${suffix}`, { force: true });
    const db = openLibraryDatabase({ path: dbPath, dbKey });
    try {
      const repo = new PhotosRepository(db);
      repo.restoreManifest(candidate.manifest, discovery.bootstrap.keys);
      if ('boards' in candidate.manifest) restoreBoards(db, candidate.manifest.boards);
      if (candidate.manifest.schema !== 2) new ProtectedRecoveryRepository(db).restore(candidate.manifest);
      if (candidate.manifest.schema === 4 || candidate.manifest.schema === 5) {
        new ActivityRepository(db).restoreSnapshot(candidate.manifest.activity);
      }
      const rebuilt = repo.manifestSnapshot();
      const expectedBoards = candidate.manifest.schema === 5 ? candidate.manifest.boards : [];
      const expected = {
        keyIds: candidate.manifest.keyIds,
        totals: candidate.manifest.totals,
        photos: candidate.manifest.photos,
        albums: candidate.manifest.albums,
        boards: expectedBoards,
      };
      const actual = {
        keyIds: rebuilt.keyIds,
        totals: rebuilt.totals,
        photos: rebuilt.photos,
        albums: rebuilt.albums,
        boards: boardsSnapshot(db),
      };
      if (!isDeepStrictEqual(actual, expected)) throw new RestoreError('corrupt', 'rebuilt catalog does not match the manifest');
      for (const photo of candidate.manifest.photos) {
        if (!(await store.verifyOriginal(photo.contentHash, discovery.resolveKey, photo.id))) {
          throw new RestoreError('corrupt', `final verification failed for ${photo.id}`);
        }
      }
      if (candidate.manifest.schema !== 2) {
        const protectedRepo = new ProtectedRecoveryRepository(db);
        const protectedExpected = {
          protectedAlbums: candidate.manifest.protectedAlbums,
          protectedPhotos: candidate.manifest.protectedPhotos,
        };
        if (!isDeepStrictEqual(protectedRepo.snapshot(), protectedExpected)) {
          throw new RestoreError('corrupt', 'rebuilt protected catalog does not match the manifest');
        }
        for (const photo of candidate.manifest.protectedPhotos) {
          for (const object of photo.objects) {
            if (object.status === 'offloaded') continue;
            const actual = await protectedStore.ciphertextInfo(photo.albumId, photo.blobRef, object.kind);
            if (actual.sha256 !== object.sha256 || actual.bytes !== object.bytes) {
              throw new RestoreError('corrupt', 'final protected ciphertext verification failed');
            }
          }
        }
      }
      if (candidate.manifest.schema === 4) {
        const activity = new ActivityRepository(db).backupSnapshot();
        if (!isDeepStrictEqual(activity, candidate.manifest.activity)) {
          throw new RestoreError('corrupt', 'rebuilt activity history does not match the manifest');
        }
      }
    } finally {
      db.close();
    }
  }

  private emit(stage: RestoreProgress['stage'], done: number, total: number, photoId: string | null): void {
    this.deps.events.progress({ stage, done, total, photoId });
  }
}
