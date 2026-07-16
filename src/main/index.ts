import { readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { buffer } from 'node:stream/consumers';

import { app, BrowserWindow, dialog, session, shell } from 'electron';

import { events } from '../shared/ipc/channels.js';
import { createEmitter } from '../shared/ipc/registry.js';
import { BlobStore, BlobStoreError } from './blobs/blob-store.js';
import { ProtectedBlobStore } from './blobs/protected-blob-store.js';
import { createWindow, reloadContentWindowsForLock, relaunchLocked } from './app-window.js';
import { KeyStore } from './crypto/keystore.js';
import { createAppLockRuntime, registerAppLockIpc } from './crypto/app-lock-runtime.js';
import { drainWithCancellationFence } from './crypto/library-shutdown.js';
import { TestFileCredentialAnchorStore } from './crypto/test-credential-anchor.js';
import { pickSafeStorage } from './crypto/safe-storage-runtime.js';
import { ProtectedAlbumAuthorityRegistry } from './crypto/protected-album-authority.js';
import { ProtectedAlbumService } from './crypto/protected-album-service.js';
import { openLibraryDatabase } from './db/database.js';
import { PhotosRepository } from './db/photos-repository.js';
import { ProtectedAlbumRepository } from './db/protected-album-repository.js';
import { ProtectedPhotoMigrationRepository } from './db/protected-photo-migration-repository.js';
import { run } from './db/sql.js';
import { registerFullProtocol } from './fullres/full-protocol.js';
import type { FullService } from './fullres/full-service.js';
import { createFullRuntime } from './fullres/full-runtime.js';
import { extractMetadata } from './import/exif.js';
import { ImportEngine } from './import/import-engine.js';
import { ImportJournal } from './import/import-journal.js';
import { ImportService } from './import/import-service.js';
import { ThumbnailPool } from './import/thumbnail-pool.js';
import { ThumbnailService } from './import/thumbnail-service.js';
import { ulid } from './import/ulid.js';
import { createAutoBackupScheduler } from './backup/auto-backup.js';
import { BackupEngine, type BackupRunResult } from './backup/backup-engine.js';
import { createBackupAuditLogger } from './backup/backup-audit.js';
import { createBackupFacade } from './backup/backup-facade.js';
import { createBackupIntegrityRuntime } from './backup/integrity-runtime.js';
import { sealManifestJson } from './backup/manifest-sealer.js';
import { createRecoveryHealthCheck } from './backup/recovery-health.js';
import type { OffloadService } from './backup/offload.js';
import type { EphemeralOriginalService } from './backup/ephemeral-originals.js';
import { createOriginalCustodyRuntime } from './backup/original-custody-runtime.js';
import { ProviderRuntime } from './backup/provider-runtime.js';
import { RestoreRuntime } from './backup/restore-runtime.js';
import { activationOperationsForHarness } from './backup/restore-fault.js';
import { createRestoreFacade } from './backup/restore-facade.js';
import { recoverInterruptedActivation, restorePaths } from './backup/restore-staging.js';
import { sealKeyStoreRecoveryBootstrap } from './backup/recovery-bootstrap.js';
import { ConsistencyChecker } from './library/consistency.js';
import { PurgeService } from './library/purge-service.js';
import { createPurgeRuntime, type DrainablePurgeFacade } from './library/purge-runtime.js';
import { StartupMaintenance } from './library/startup-maintenance.js';
import { SyncLedger } from './backup/sync-ledger.js';
import { createRecoveryKeyFacade } from './crypto/recovery-key-facade.js';
import { pickRecoveryKeyPath } from './crypto/recovery-key-picker.js';
import { createExportRuntime, type DrainableExportFacade } from './export/export-runtime.js';
import { createProtectedExportRuntime, type DrainableProtectedExportFacade } from './export/protected-export-runtime.js';
import {
  registerAlbumHandlers,
  registerBackupHandlers,
  registerExportHandlers,
  registerImportHandlers,
  registerIpcHandlers,
  registerKeysHandlers,
  registerLibraryHandlers,
  registerPurgeHandlers,
  registerProtectedAlbumHandlers,
  registerRestoreHandlers,
  registerSettingsHandlers,
} from './ipc.js';
import { getSettingsStore } from './settings/settings-runtime.js';
import { throttlePercentOf } from '../shared/settings/settings.js';
import { LibraryService } from './library/library-service.js';
import { ProtectedLibraryService } from './library/protected-library-service.js';
import { ProtectedMediaService } from './library/protected-media-service.js';
import { seedLibrary, seedSynthetic } from './library/seed.js';
import { registerSchemePrivileges } from './protocol-privileges.js';
import { registerThumbProtocol } from './thumbs/thumb-protocol.js';
import { ThumbService } from './thumbs/thumb-service.js';

// Test/dev harness hooks (#72): OVERLOOK_USER_DATA isolates profiles (E2E
// temp profile per run); OVERLOOK_SEED seeds an empty library at startup;
// OVERLOOK_INSECURE_KEYSTORE swaps in an obfuscation-only keystore for
// environments without a real keychain (CI Linux). The insecure keystore is
// honored ONLY in unpackaged builds and logs loudly — real libraries never
// touch it (ADR-0004 stance stands for production).
//
// Steering/fixture hooks (seeded rows, fixture import/export dirs, injected
// backup faults, redirected profile) are honored ONLY in unpackaged builds
// (#129 F1) — a packaged app must not be steerable via env, mirroring the
// OVERLOOK_INSECURE_KEYSTORE gate. Read every such hook through harnessEnv so
// the gate can't be forgotten at a call site. Genuine runtime tuning (e.g.
// OVERLOOK_FULL_CACHE_MB, a cache budget) is not a harness hook and stays.
function harnessEnv(name: string): string | undefined {
  return app.isPackaged ? undefined : process.env[name];
}

const userDataOverride = harnessEnv('OVERLOOK_USER_DATA');
if (userDataOverride !== undefined && userDataOverride !== '') {
  app.setPath('userData', userDataOverride);
}

// Privileged-scheme registration must precede app ready (#75, #91).
registerSchemePrivileges();

// Lazy library bootstrap: nothing touches the keychain or the database until
// the renderer's first library.* call (the E2E smoke never does).
let libraryService: LibraryService | undefined;

function broadcast(send: (win: BrowserWindow) => void): void {
  for (const win of BrowserWindow.getAllWindows()) {
    send(win);
  }
}

interface LibraryParts {
  readonly db: ReturnType<typeof openLibraryDatabase>;
  readonly blobStore: BlobStore;
  readonly blobStoreReady: Promise<void>;
  readonly keyStore: KeyStore;
  readonly protectedAuthorities: ProtectedAlbumAuthorityRegistry;
  readonly protectedAlbums: ProtectedAlbumService;
  readonly protectedLibrary: ProtectedLibraryService;
}

let libraryParts: LibraryParts | undefined;
let releasedMaster: Buffer | undefined;

function getLibraryService(): LibraryService {
  if (libraryService === undefined) {
    const dataDir = path.join(app.getPath('userData'), 'library');
    const keyStore =
      releasedMaster === undefined
        ? KeyStore.open({ safeStorage: pickSafeStorage(), dataDir })
        : KeyStore.openWithMaster({ safeStorage: pickSafeStorage(), dataDir }, releasedMaster);
    // The DB key is KEY #1: stable across rotation (rotation only moves the
    // blob WRITE key), wrapped by the master key per ADR-0004. A dedicated
    // db-key slot can arrive later via migration if ever needed.
    const dbKey = keyStore.resolver()(1);
    if (dbKey === undefined) {
      throw new Error('library key #1 is missing; cannot key the database');
    }
    const db = openLibraryDatabase({ path: path.join(dataDir, 'library.db'), dbKey });
    const store = new BlobStore({ dataDir });
    const protectedStore = new ProtectedBlobStore(dataDir);
    // Reads fail clean before init, but WRITES race the directory creation
    // on a fresh profile — importers await this promise (PR #183 review).
    const blobStoreReady = store.init();
    const protectedStoreReady = protectedStore.init();
    // photos.key_id references keys(id): the current key's row must exist
    // before the FIRST real import on a fresh profile (#90 caught this —
    // previously only the dev seed wrote it). The wrapped key itself lives
    // in the keystore; this row is FK metadata.
    run(
      db,
      `INSERT OR IGNORE INTO keys (id, wrapped_key, created_at) VALUES (?, 'keystore-managed', ?)`,
      keyStore.currentKey().id,
      new Date().toISOString(),
    );
    const libraryId = getProviderRuntime().libraryId();
    const authorities = new ProtectedAlbumAuthorityRegistry();
    const protectedAlbums = new ProtectedAlbumService({
      libraryId,
      repository: new ProtectedAlbumRepository(db, libraryId),
      authorities,
    });
    const protectedLibrary = new ProtectedLibraryService({
      libraryId,
      albums: new ProtectedAlbumRepository(db, libraryId),
      photos: new ProtectedPhotoMigrationRepository(db),
      blobs: protectedStore,
      blobsReady: protectedStoreReady,
      authorities,
    });
    libraryParts = {
      db,
      blobStore: store,
      blobStoreReady,
      keyStore,
      protectedAuthorities: authorities,
      protectedAlbums,
      protectedLibrary,
    };
    startupMaintenance.schedule();
    const emitChanged = createEmitter(events.libraryChanged, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    const emitPending = createEmitter(events.pendingCountChanged, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    libraryService = new LibraryService(db, {
      libraryChanged: (photoIds) => {
        emitChanged({ photoIds: [...photoIds] });
      },
      pendingCountChanged: (count) => {
        emitPending({ count });
        // Dirtying edits (favorite, album membership, restore) behave like
        // imports (#267): the debounced trigger runs under the same policy
        // gates (auto-backup setting, connected provider).
        if (count > 0) {
          scheduleAutoBackup();
        }
      },
    });
  }
  return libraryService;
}

let importService: ImportService | undefined;
let thumbnailPool: ThumbnailPool | undefined;

function getImportService(): ImportService {
  if (importService === undefined) {
    getLibraryService();
    const parts = libraryParts;
    if (parts === undefined) {
      throw new Error('library bootstrap failed; import service unavailable');
    }
    const repo = new PhotosRepository(parts.db);
    const emitScanProgress = createEmitter(events.scanProgress, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    const emitCopyProgress = createEmitter(events.importCopyProgress, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    const emitThumbProgress = createEmitter(events.importThumbProgress, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    const emitChanged = createEmitter(events.libraryChanged, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    const emitPending = createEmitter(events.pendingCountChanged, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    thumbnailPool = new ThumbnailPool({ workerUrl: new URL('./thumbnail-worker.js', import.meta.url) });
    const thumbs = new ThumbnailService(thumbnailPool, parts.blobStore);
    const journal = new ImportJournal(path.join(app.getPath('userData'), 'library', 'import-journal.json'));
    const engine = new ImportEngine({
      readFile: async (filePath) => readFile(filePath),
      deleteFile: async (filePath) => unlink(filePath),
      readManifest: async () => journal.read(),
      writeManifest: async (manifest) => journal.write(manifest),
      repo: {
        hasContentHash: (hash) => repo.hasContentHash(hash),
        get: (id) => repo.get(id),
        insert: (photo) => {
          repo.insert(photo);
        },
      },
      blobs: {
        putOriginal: async (plaintext, key, photoId) => {
          await parts.blobStoreReady;
          return parts.blobStore.putOriginal(plaintext, key, photoId);
        },
        verifyOriginal: async (contentHash, resolveKey, photoId) => parts.blobStore.verifyOriginal(contentHash, resolveKey, photoId),
      },
      generateThumbs: async (request) => {
        await parts.blobStoreReady;
        return thumbs.generateFor(request);
      },
      extractMetadata,
      currentKey: () => parts.keyStore.currentKey(),
      resolveKey: parts.keyStore.resolver(),
      newId: ulid,
      now: () => new Date().toISOString(),
      events: {
        copyProgress: (done, total) => {
          emitCopyProgress({ done, total });
        },
        thumbProgress: (done, total) => {
          emitThumbProgress({ done, total });
        },
      },
    });
    importService = new ImportService(
      repo,
      {
        scanProgress: (path, progress) => {
          emitScanProgress({ path, ...progress });
        },
        copyProgress: (done, total) => {
          emitCopyProgress({ done, total });
        },
        thumbProgress: (done, total) => {
          emitThumbProgress({ done, total });
        },
        imported: (photoIds) => {
          emitChanged({ photoIds: [...photoIds] });
          emitPending({ count: repo.stats().pending });
        },
      },
      engine,
      () => harnessEnv('OVERLOOK_IMPORT_SOURCE'),
    );
    // Crash-safety (#87): a journaled batch from an interrupted run
    // completes before any new import starts. Recovered photos get the same
    // auto-backup guarantee as IPC imports (#111) — the crash already cost
    // the user once.
    void importService
      .resume()
      .then((summary) => {
        if (summary !== null && summary.imported > 0) {
          getBackupEngine();
          autoBackupTrigger?.();
        }
      })
      .catch((error: unknown) => {
        console.error('[overlook] import resume failed', error);
      });
  }
  return importService;
}

let thumbService: ThumbService | undefined;

function getThumbService(): ThumbService {
  if (thumbService === undefined) {
    getLibraryService();
    const parts = libraryParts;
    if (parts === undefined) {
      throw new Error('library bootstrap failed; thumb service unavailable');
    }
    const repo = new PhotosRepository(parts.db);
    thumbService = new ThumbService({
      admit: (photoId) => repo.get(photoId) !== undefined,
      loadThumb: async (photoId, size) => {
        const photo = repo.get(photoId);
        if (photo === undefined) {
          return null;
        }
        try {
          const stream = parts.blobStore.getThumbStream(photo.contentHash, size, parts.keyStore.resolver(), photoId);
          return { bytes: await buffer(stream), contentHash: photo.contentHash };
        } catch (error) {
          if (error instanceof BlobStoreError) {
            return null; // No thumb in the store yet — M05 backfills.
          }
          throw error;
        }
      },
    });
  }
  return thumbService;
}

let fullService: FullService | undefined;
let protectedMediaService: ProtectedMediaService | undefined;

function getFullService(): FullService {
  if (fullService === undefined) {
    getLibraryService();
    const parts = libraryParts;
    if (parts === undefined) {
      throw new Error('library bootstrap failed; full-res service unavailable');
    }
    const repo = new PhotosRepository(parts.db);
    fullService = createFullRuntime({
      repo,
      blobs: parts.blobStore,
      resolveKey: parts.keyStore.resolver(),
      ephemeral: getEphemeralOriginalService,
      cacheMb: process.env['OVERLOOK_FULL_CACHE_MB'],
    });
  }
  return fullService;
}

function getProtectedAlbumService(): ProtectedAlbumService {
  getLibraryService();
  if (libraryParts === undefined) throw new Error('library bootstrap failed; protected albums unavailable');
  return libraryParts.protectedAlbums;
}

function getProtectedLibraryService(): ProtectedLibraryService {
  getLibraryService();
  if (libraryParts === undefined) throw new Error('library bootstrap failed; protected library unavailable');
  return libraryParts.protectedLibrary;
}

function getProtectedMediaService(): ProtectedMediaService {
  if (protectedMediaService === undefined) {
    const library = getProtectedLibraryService();
    const parts = libraryParts;
    if (parts === undefined) throw new Error('library bootstrap failed; protected media unavailable');
    protectedMediaService = new ProtectedMediaService({
      library,
      authorities: parts.protectedAuthorities,
    });
  }
  return protectedMediaService;
}

let backupEngine: BackupEngine | undefined;
let offloadService: OffloadService | undefined;
let ephemeralOriginalService: EphemeralOriginalService | undefined;
const activeBackupControllers = new Set<AbortController>();
const activeBackupRuns = new Set<Promise<BackupRunResult>>();
let providerRuntime: ProviderRuntime | undefined;
let providerWorkCount = 0;
const providerIdleWaiters = new Set<() => void>();

function changeProviderWork(delta: 1 | -1): void {
  providerWorkCount += delta;
  if (providerWorkCount === 0) {
    for (const resolve of providerIdleWaiters) resolve();
    providerIdleWaiters.clear();
  }
}

function providerIdle(): Promise<void> {
  if (providerWorkCount === 0) return Promise.resolve();
  return new Promise((resolve) => providerIdleWaiters.add(resolve));
}

function getProviderRuntime(): ProviderRuntime {
  providerRuntime ??= new ProviderRuntime({
    dataDir: () => path.join(app.getPath('userData'), 'library'),
    providerCredentialDir: (providerId) => path.join(app.getPath('userData'), 'provider-auth', providerId),
    safeStorage: pickSafeStorage,
    openExternal: async (url) => shell.openExternal(url),
    setProviderId: (id) => getSettingsStore().set({ providerId: id }),
    providerId: () => getSettingsStore().get().providerId,
    isWorkActive: () => providerWorkCount > 0,
    isPackaged: app.isPackaged,
    harnessEnv,
  });
  return providerRuntime;
}

/** Fresh-profile onboarding must enumerate/connect providers without
 * bootstrapping an empty local library first. The browser scope is never
 * used for backup writes; discovered homes are re-scoped before restore. */
function ensureRestoreProviderRegistry(): ProviderRuntime {
  const runtime = getProviderRuntime();
  if (runtime.descriptors().length === 0) {
    runtime.buildProvider({
      mockRootDir: path.join(app.getPath('userData'), 'mock-remote'),
      fault: harnessEnv('OVERLOOK_BACKUP_FAULT'),
      libraryId: 'restore-browser',
    });
  }
  return runtime;
}
let autoBackupTrigger: (() => void) | undefined;

/** Dirtying EDITS auto-backup like imports do (#267) — before this, an
 * album add or favorite left the provider progress standing until a
 * manual run. Trailing debounce; convergence lives in autoBackupTrigger. */
const scheduleAutoBackup = createAutoBackupScheduler(() => {
  getBackupEngine();
  autoBackupTrigger?.();
});
let manifestSyncTrigger: (() => void) | undefined;
let purgeService: PurgeService | undefined;
let purgeRuntime: DrainablePurgeFacade | undefined;
let consistencyChecker: ConsistencyChecker | undefined;
const startupMaintenance = new StartupMaintenance({
  purge: () => getPurgeService().purgeExpired(),
  repair: () => consistencyChecker?.repair(),
});

function cancelScheduledLibraryWork(): void {
  scheduleAutoBackup.cancel();
  startupMaintenance.cancel();
}

function getPurgeService(): PurgeService {
  getBackupEngine();
  if (purgeService === undefined) throw new Error('backup bootstrap failed; purge unavailable');
  return purgeService;
}
function getPurgeRuntime(): DrainablePurgeFacade {
  getPurgeService();
  if (purgeRuntime === undefined) throw new Error('backup bootstrap failed; purge runtime unavailable');
  return purgeRuntime;
}
function getOffloadService(): OffloadService {
  getBackupEngine();
  if (offloadService === undefined) throw new Error('backup bootstrap failed; offload unavailable');
  return offloadService;
}

function getEphemeralOriginalService(): EphemeralOriginalService {
  getBackupEngine();
  if (ephemeralOriginalService === undefined) throw new Error('backup bootstrap failed; ephemeral originals unavailable');
  return ephemeralOriginalService;
}

function getBackupEngine(): BackupEngine {
  if (backupEngine === undefined) {
    getLibraryService();
    const parts = libraryParts;
    if (parts === undefined) {
      throw new Error('library bootstrap failed; backup unavailable');
    }
    const repo = new PhotosRepository(parts.db);
    const ledger = new SyncLedger(parts.db);
    const emitProgress = createEmitter(events.backupProgress, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    const emitCompleted = createEmitter(events.backupCompleted, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    const emitLibraryChanged = createEmitter(events.libraryChanged, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    const auditPath = path.join(app.getPath('userData'), 'library', 'backup-audit.log');
    const audit = createBackupAuditLogger(auditPath);
    const emitPending = createEmitter(events.pendingCountChanged, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    const provider = getProviderRuntime().buildProvider({
      mockRootDir: path.join(app.getPath('userData'), 'mock-remote'),
      fault: harnessEnv('OVERLOOK_BACKUP_FAULT'),
    });
    const emitSyncStateChanged = createEmitter(events.photoSyncStateChanged, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    const integrityScrubber = createBackupIntegrityRuntime({
      db: parts.db,
      provider,
      repo,
      blobs: parts.blobStore,
      resolveKey: parts.keyStore.resolver(),
      markUnrecoverable: (photoId) => {
        ledger.repairStatus(photoId, 'error');
        emitSyncStateChanged({ updates: [{ id: photoId, syncState: 'error' }] });
      },
      audit,
    });
    backupEngine = new BackupEngine({
      provider,
      ledger,
      dirtyPhotos: () => repo.dirtyPhotos(),
      encryptedStream: (hash) => parts.blobStore.getEncryptedStream(hash),
      sealManifest: (json) => sealManifestJson(json, parts.keyStore.currentKey()),
      sealRecoveryBootstrap: (generatedAt) =>
        sealKeyStoreRecoveryBootstrap({ keyStore: parts.keyStore, libraryId: getProviderRuntime().libraryId(), generatedAt }),
      libraryId: () => getProviderRuntime().libraryId(),
      manifestSnapshot: () => repo.manifestSnapshot(),
      // Live reads (#111): every run and every maybeAutoRun sees the
      // store's current values — no restart needed after a settings change.
      settings: () => {
        const current = getSettingsStore().get();
        return {
          throttlePercent: throttlePercentOf(current),
          wifiOnly: current.wifiOnly,
          // Disconnected (#114) means no automatic uploads — the switch is
          // disabled in the dialog for the same reason.
          autoBackupOnImport: current.autoBackupOnImport && getProviderRuntime().activeId() !== null,
        };
      },
      network: () => 'unknown',
      events: { progress: (done, total, photoId) => emitProgress({ done, total, photoId }) },
      now: () => Date.now(),
      sleep: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      pendingCountChanged: (count) => emitPending({ count }),
      syncStateChanged: (updates) => emitSyncStateChanged({ updates: [...updates] }),
      audit,
      integrityScrub: () => integrityScrubber.scrub(),
      recoveryGenerationHealthy: createRecoveryHealthCheck(provider, () => getProviderRuntime().libraryId(), parts.keyStore),
    });
    const emitEphemeralState = createEmitter(events.ephemeralOriginalState, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    const custody = createOriginalCustodyRuntime({
      provider,
      connected: () => getProviderRuntime().activeId() !== null,
      ledger,
      repo,
      blobs: parts.blobStore,
      blobsReady: parts.blobStoreReady,
      resolveKey: parts.keyStore.resolver(),
      reOffloadAfterViewing: () => getSettingsStore().get().reOffloadAfterViewing,
      workChanged: changeProviderWork,
      syncStateChanged: (updates) => emitSyncStateChanged({ updates: [...updates] }),
      storageChanged: () => broadcast((win) => win.webContents.send(events.storageChanged.name, {})),
      stateChanged: emitEphemeralState,
      invalidateFull: (photoId) => fullService?.invalidate(photoId),
      audit,
    });
    offloadService = custody.offload;
    ephemeralOriginalService = custody.ephemeral;
    purgeService = new PurgeService({
      repo: {
        getDeleted: (id) => repo.getDeleted(id),
        purgeRow: (id) => {
          repo.purgeRow(id);
        },
        countAnyByContentHash: (hash) => repo.countAnyByContentHash(hash),
        expiredDeleted: (cutoff) => repo.expiredDeleted(cutoff),
      },
      blobs: {
        deleteOriginal: async (hash) => parts.blobStore.deleteOriginal(hash),
        deleteThumbs: async (hash) => parts.blobStore.deleteThumbs(hash),
      },
      provider,
      connected: () => getProviderRuntime().activeId() !== null,
      // Purging changes manifestSnapshot() — same owed-generation rule (and
      // quiet push) as soft delete (PR #218 review).
      oweManifest: () => manifestSyncTrigger?.(),
      libraryChanged: (photoIds) => {
        emitLibraryChanged({ photoIds: [...photoIds] });
      },
      audit,
      now: () => Date.now(),
      sleep: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    purgeRuntime = createPurgeRuntime(purgeService);
    consistencyChecker = new ConsistencyChecker({
      rows: () => repo.allRows(),
      hiddenOwnedHashes: () => repo.migrationOwnedContentHashes(),
      blobs: {
        listOriginalHashes: async () => parts.blobStore.listOriginalHashes(),
        listThumbHashes: async () => parts.blobStore.listThumbHashes(),
        listStaged: async () => parts.blobStore.listStaged(),
        hasOriginal: (hash) => parts.blobStore.hasOriginal(hash),
        deleteOriginal: async (hash) => parts.blobStore.deleteOriginal(hash),
        deleteThumbs: async (hash) => parts.blobStore.deleteThumbs(hash),
        removeStaged: async (name) => parts.blobStore.removeStaged(name),
      },
      remoteHas: async (hash) => {
        try {
          await provider.verify(`blobs/${hash.slice(0, 2)}/${hash}`);
          return true;
        } catch {
          return false;
        }
      },
      setStatus: (photoId, status) => {
        ledger.repairStatus(photoId, status);
      },
      libraryChanged: (photoIds) => {
        emitLibraryChanged({ photoIds: [...photoIds] });
      },
      audit,
    });
    // Completion events drive the toasts (#106) and the card's bar clear
    // (#108). `auto` rides along so the renderer keeps automatic successes
    // QUIET — an auto-backup's green toast was racing (and replacing) the
    // import-complete toast (#116); failures stay loud for every trigger.
    const engine = backupEngine;
    const originalRun = engine.run.bind(engine);
    const runAndReportCore = async (auto: boolean, signal?: AbortSignal): Promise<BackupRunResult> => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal?.aborted === true) controller.abort();
      else signal?.addEventListener('abort', abort, { once: true });
      activeBackupControllers.add(controller);
      changeProviderWork(1);
      try {
        const result = await originalRun(controller.signal);
        if (result.skipped === null) {
          emitCompleted({
            uploaded: result.uploaded,
            failed: result.failed,
            manifestUploaded: result.manifestUploaded,
            auto,
            integrity: result.integrity,
          });
        }
        return result;
      } finally {
        signal?.removeEventListener('abort', abort);
        activeBackupControllers.delete(controller);
        changeProviderWork(-1);
      }
    };
    const runAndReport = (auto: boolean, signal?: AbortSignal): Promise<BackupRunResult> => {
      const run = runAndReportCore(auto, signal);
      activeBackupRuns.add(run);
      const remove = () => activeBackupRuns.delete(run);
      void run.then(remove, remove);
      return run;
    };
    engine.run = (signal?: AbortSignal) => runAndReport(false, signal);
    // The auto-backup trigger (#105/#111): same single-flight run, marked
    // auto for the quiet-success rule above.
    autoBackupTrigger = () => {
      const current = getSettingsStore().get();
      if (current.autoBackupOnImport && getProviderRuntime().activeId() !== null) {
        void runAndReport(true)
          .then((result) => {
            // An edit landing MID-RUN joins the in-flight run without
            // uploading (the dirty set is the next run's queue) — re-arm
            // until clean so edits converge to zero (#267). A failing run
            // stops the loop: its rows sit in 'error' with the red toast,
            // and retry stays a user decision.
            if (result.skipped === null && result.failed === 0 && repo.pendingCount() > 0) {
              scheduleAutoBackup();
            }
          })
          .catch(() => undefined);
      }
    };
    // Not gated on autoBackupOnImport: this is manifest CORRECTNESS, not a
    // convenience upload. Push immediately only when the debt is PURE
    // (pending 0 — the toolbar is disabled, so nothing else would settle
    // it); with dirty rows the user's next backup carries the manifest,
    // and we never upload blobs they didn't ask for. Disconnected keeps
    // the debt for the next run.
    manifestSyncTrigger = () => {
      engine.oweManifest();
      if (getProviderRuntime().activeId() !== null && repo.pendingCount() === 0) {
        void runAndReport(true).catch(() => undefined);
      }
    };
  }
  return backupEngine;
}

let exportFacade: DrainableExportFacade | undefined;
let protectedExportFacade: DrainableProtectedExportFacade | undefined;

function getExportFacade(): DrainableExportFacade {
  if (exportFacade === undefined) {
    getLibraryService();
    const parts = libraryParts;
    if (parts === undefined) {
      throw new Error('library bootstrap failed; export unavailable');
    }
    const repo = new PhotosRepository(parts.db);
    const emitProgress = createEmitter(events.exportProgress, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    exportFacade = createExportRuntime({
      repo: { get: (id) => repo.get(id) },
      blobs: parts.blobStore,
      resolveKey: parts.keyStore.resolver(),
      openOriginal: async (photo) => {
        const service = getEphemeralOriginalService();
        const opened = await service.open(photo.id, 'export');
        return { stream: opened.stream, release: opened.custody === 'ephemeral' ? () => service.release(photo.id, 'export') : undefined };
      },
      pickDestination: async () => {
        // Harness hook (#101, OVERLOOK_* family): the mock-file-dialog seam
        // the export E2E drives — a fixed destination instead of the picker.
        const fixture = harnessEnv('OVERLOOK_EXPORT_DESTINATION');
        if (fixture !== undefined && fixture !== '') {
          return fixture;
        }
        const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
      progress: (done, total) => emitProgress({ done, total }),
    });
  }
  return exportFacade;
}

function getProtectedExportFacade(): DrainableProtectedExportFacade {
  if (protectedExportFacade === undefined) {
    const emitProgress = createEmitter(events.exportProgress, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    protectedExportFacade = createProtectedExportRuntime({
      library: getProtectedLibraryService(),
      pickDestination: async () => {
        const fixture = harnessEnv('OVERLOOK_EXPORT_DESTINATION');
        if (fixture !== undefined && fixture !== '') return fixture;
        const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
      progress: (done, total) => emitProgress({ done, total }),
      failure: () => console.error('[overlook] protected export failed'),
    });
  }
  return protectedExportFacade;
}

async function closeLibrary(drainRestore: boolean): Promise<void> {
  autoBackupTrigger = undefined;
  manifestSyncTrigger = undefined;
  importService?.close();
  exportFacade?.close();
  protectedExportFacade?.close();
  purgeRuntime?.close();
  libraryParts?.protectedAlbums.relockAll();
  for (const controller of activeBackupControllers) controller.abort();
  await drainWithCancellationFence(cancelScheduledLibraryWork, [
    importService?.drain() ?? Promise.resolve(),
    exportFacade?.drain() ?? Promise.resolve(),
    protectedExportFacade?.drain() ?? Promise.resolve(),
    purgeRuntime?.drain() ?? Promise.resolve(),
    startupMaintenance.drain(),
    Promise.allSettled([...activeBackupRuns]),
    drainRestore ? (restoreRuntime?.close() ?? Promise.resolve()) : Promise.resolve(),
    drainRestore ? providerIdle() : Promise.resolve(),
    Promise.all([
      thumbService?.close() ?? Promise.resolve(),
      fullService?.close() ?? Promise.resolve(),
      protectedMediaService?.close() ?? Promise.resolve(),
    ]),
    thumbnailPool?.close() ?? Promise.resolve(),
    ...(drainRestore ? [session.defaultSession.clearCache(), reloadContentWindowsForLock()] : []),
  ]);
  libraryParts?.protectedAlbums.close();
  libraryParts?.db.close();
  libraryParts?.keyStore.close();
  libraryService = undefined;
  libraryParts = undefined;
  importService = undefined;
  thumbnailPool = undefined;
  thumbService = undefined;
  fullService = undefined;
  protectedMediaService = undefined;
  backupEngine = undefined;
  offloadService = undefined;
  ephemeralOriginalService = undefined;
  [purgeService, purgeRuntime] = [undefined, undefined];
  consistencyChecker = undefined;
  exportFacade = undefined;
  protectedExportFacade = undefined;
  if (drainRestore) restoreRuntime = undefined;
}

const closeLibraryForRestore = (): Promise<void> => closeLibrary(false);
const closeLibraryForLock = (): Promise<void> => closeLibrary(true);

let appLockController: ReturnType<typeof createAppLockRuntime> | undefined;

function getAppLockController(): ReturnType<typeof createAppLockRuntime> {
  if (appLockController === undefined) {
    const dataDir = path.join(app.getPath('userData'), 'library');
    appLockController = createAppLockRuntime({
      dataDir,
      safeStorage: pickSafeStorage(),
      ...(harnessEnv('OVERLOOK_APP_LOCK_TEST_ANCHOR') === '1'
        ? { anchorStore: new TestFileCredentialAnchorStore(path.join(app.getPath('userData'), 'app-lock-test-anchor.json')) }
        : {}),
      openAuthorized: (masterKey) => {
        if (masterKey === undefined) return;
        const authorized = Buffer.from(masterKey);
        releasedMaster = authorized;
        try {
          getLibraryService();
        } finally {
          authorized.fill(0);
          releasedMaster = undefined;
        }
      },
      closeAuthorized: closeLibraryForLock,
      failClosed: relaunchLocked,
    });
  }
  return appLockController;
}

let restoreRuntime: RestoreRuntime | undefined;

function getRestoreRuntime(): RestoreRuntime {
  if (restoreRuntime === undefined) {
    const emitProgress = createEmitter(events.restoreProgress, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    restoreRuntime = new RestoreRuntime({
      targetDir: path.join(app.getPath('userData'), 'library'),
      workerUrl: new URL('./thumbnail-worker.js', import.meta.url),
      safeStorage: pickSafeStorage,
      sources: (providerId) => ensureRestoreProviderRegistry().restoreSources(providerId),
      sessionId: ulid,
      progress: emitProgress,
      beforeActivate: closeLibraryForRestore,
      activationOperations: activationOperationsForHarness(harnessEnv('OVERLOOK_RESTORE_FAULT')),
      workStarted: () => changeProviderWork(1),
      workFinished: () => changeProviderWork(-1),
      activated: () => {
        if (harnessEnv('OVERLOOK_RESTORE_NO_RELAUNCH') === '1') return;
        setTimeout(() => {
          app.relaunch();
          app.exit(0);
        }, 250);
      },
    });
  }
  return restoreRuntime;
}

void app.whenReady().then(async () => {
  // Recover the activation rename crash window before IPC can classify/open the library.
  await recoverInterruptedActivation(restorePaths(path.join(app.getPath('userData'), 'library')));
  const lock = getAppLockController();
  await lock.initialize();
  registerIpcHandlers();
  registerAppLockIpc({
    controller: lock,
    currentMaster: () => {
      getLibraryService();
      if (libraryParts === undefined) throw new Error('library bootstrap failed; no master key available');
      return libraryParts.keyStore.masterKeyBytes();
    },
    libraryId: () => getProviderRuntime().libraryId(),
    dataDir: path.join(app.getPath('userData'), 'library'),
    pickRecovery: () => pickRecoveryKeyPath(harnessEnv('OVERLOOK_KEY_IMPORT_SOURCE')),
    send: (name, payload) => broadcast((win) => win.webContents.send(name, payload)),
    settings: () => getSettingsStore().get(),
  });
  registerLibraryHandlers(getLibraryService, () => {
    // Soft delete of a synced row leaves pendingCount at 0 with a STALE
    // remote manifest — a restore-from-backup would resurrect the photo
    // (PR #218 review). Owe the generation and push it quietly now; if
    // disconnected/offline the debt persists into the next run.
    getBackupEngine();
    manifestSyncTrigger?.();
  });
  registerAlbumHandlers(getLibraryService, ulid);
  registerProtectedAlbumHandlers(getProtectedAlbumService, getProtectedLibraryService, getProtectedExportFacade);
  registerThumbProtocol(getThumbService, () => lock.requireContentAccess(), getProtectedMediaService);
  registerFullProtocol(getFullService, () => lock.requireContentAccess(), getProtectedMediaService);
  registerImportHandlers(
    getImportService,
    async () => {
      // Harness hook (#237, OVERLOOK_* family): the mock-file-dialog seam
      // the folder-import E2E drives — a fixed folder instead of the picker.
      const fixture = harnessEnv('OVERLOOK_IMPORT_FOLDER');
      if (fixture !== undefined && fixture !== '') {
        return fixture;
      }
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    () => {
      getBackupEngine();
      autoBackupTrigger?.();
    },
  );
  registerExportHandlers(getExportFacade);
  registerKeysHandlers(() =>
    createRecoveryKeyFacade({
      keyStore: () => {
        getLibraryService();
        if (libraryParts === undefined) throw new Error('library bootstrap failed; no key available');
        return libraryParts.keyStore;
      },
      safeStorage: pickSafeStorage,
      dataDir: () => path.join(app.getPath('userData'), 'library'),
      allowImport: () => lock.snapshot().state === 'unconfigured-unlocked',
      pickExportDestination: async () => {
        const fixture = harnessEnv('OVERLOOK_KEY_EXPORT_DESTINATION');
        if (fixture !== undefined && fixture !== '') return fixture;
        const result = await dialog.showSaveDialog({ defaultPath: 'overlook-recovery.key' });
        return result.canceled ? null : (result.filePath ?? null);
      },
      pickImportSource: () => pickRecoveryKeyPath(harnessEnv('OVERLOOK_KEY_IMPORT_SOURCE')),
    }),
  );
  registerRestoreHandlers(() =>
    createRestoreFacade({
      coordinator: () => getRestoreRuntime().coordinator,
      fresh: () => !existsSync(path.join(app.getPath('userData'), 'library', 'library.db')),
      pickKey: () => pickRecoveryKeyPath(harnessEnv('OVERLOOK_KEY_IMPORT_SOURCE')),
      busy: () => providerWorkCount > 0,
    }),
  );
  registerPurgeHandlers(() => ({
    purge: (photoIds) => getPurgeRuntime().purge(photoIds),
  }));
  registerSettingsHandlers(() => getSettingsStore());
  // Change pushes (#111): the store notifies, every window re-renders from
  // the same snapshot.
  const emitSettingsChanged = createEmitter(events.settingsChanged, (name, payload) => {
    broadcast((win) => win.webContents.send(name, payload));
  });
  getSettingsStore().subscribe((settings) => {
    emitSettingsChanged({ settings });
  });
  registerBackupHandlers(() =>
    createBackupFacade({
      runtime: ensureRestoreProviderRegistry,
      run: () => getBackupEngine().run(),
      offloadService: getOffloadService,
      ephemeralOriginalService: getEphemeralOriginalService,
      workChanged: changeProviderWork,
    }),
  );
  const contentAvailable = lock.snapshot().state === 'unconfigured-unlocked' || lock.snapshot().state === 'unlocked';
  const seedCount = Number(harnessEnv('OVERLOOK_SEED') ?? '0');
  if (contentAvailable && Number.isInteger(seedCount) && seedCount > 0) {
    getLibraryService();
    if (libraryParts !== undefined) {
      await libraryParts.blobStore.init();
      await seedLibrary(libraryParts.db, libraryParts.blobStore, libraryParts.keyStore.currentKey(), seedCount);
    }
  }
  // Metadata-only rows sharing one blob — the 200K grid perf baseline (#74).
  // Like seedLibrary, a non-empty library is left untouched (re-runs on the
  // same profile must not duplicate content hashes).
  const syntheticCount = Number(harnessEnv('OVERLOOK_SEED_SYNTHETIC') ?? '0');
  if (contentAvailable && Number.isInteger(syntheticCount) && syntheticCount > 0) {
    const service = getLibraryService();
    if (libraryParts !== undefined && service.stats().photos === 0) {
      seedSynthetic(libraryParts.db, libraryParts.keyStore.currentKey().id, 'synthetic', syntheticCount);
    }
  }
  createWindow();

  // macOS: re-create the window when the dock icon is clicked with none open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  restoreRuntime?.dispose();
  void thumbnailPool?.close();
});
