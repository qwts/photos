import { access, appendFile, readFile, rename, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buffer } from 'node:stream/consumers';

import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron';

import { events } from '../shared/ipc/channels.js';
import { createEmitter } from '../shared/ipc/registry.js';
import { BlobStore, BlobStoreError } from './blobs/blob-store.js';
import { KeyStore } from './crypto/keystore.js';
import { openLibraryDatabase } from './db/database.js';
import { PhotosRepository } from './db/photos-repository.js';
import { run } from './db/sql.js';
import { registerFullProtocol } from './fullres/full-protocol.js';
import { FullService } from './fullres/full-service.js';
import { extractMetadata } from './import/exif.js';
import { ImportEngine } from './import/import-engine.js';
import { ImportJournal } from './import/import-journal.js';
import { ImportService } from './import/import-service.js';
import { ThumbnailPool } from './import/thumbnail-pool.js';
import { ThumbnailService } from './import/thumbnail-service.js';
import { ulid } from './import/ulid.js';
import { BackupEngine, type BackupRunResult } from './backup/backup-engine.js';
import { OffloadService } from './backup/offload.js';
import { ProviderRuntime } from './backup/provider-runtime.js';
import type { StorageProvider } from './backup/provider.js';
import { ConsistencyChecker } from './library/consistency.js';
import { PurgeService } from './library/purge-service.js';
import { SyncLedger } from './backup/sync-ledger.js';
import { createEncryptStream } from './crypto/envelope.js';
import {
  RECOVERY_FILE_LENGTH,
  fingerprintOf,
  installRecoveredMaster,
  openRecoveryKey,
  RecoveryError,
  sealRecoveryKey,
} from './crypto/recovery.js';
import { ExportEngine, writeFileCleanly } from './export/export-engine.js';
import { transcodeToJpeg } from './export/transcode.js';
import {
  registerAlbumHandlers,
  registerBackupHandlers,
  registerExportHandlers,
  registerImportHandlers,
  registerIpcHandlers,
  registerKeysHandlers,
  registerLibraryHandlers,
  registerPurgeHandlers,
  registerSettingsHandlers,
  type ExportFacade,
} from './ipc.js';
import { SettingsStore } from './settings/settings-store.js';
import { throttlePercentOf } from '../shared/settings/settings.js';
import { LibraryService } from './library/library-service.js';
import { seedLibrary, seedSynthetic } from './library/seed.js';
import { registerSchemePrivileges } from './protocol-privileges.js';
import { registerThumbProtocol } from './thumbs/thumb-protocol.js';
import { ThumbService } from './thumbs/thumb-service.js';
import type { SafeStorageLike } from './crypto/keystore.js';

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

function devInsecureKeystore(): SafeStorageLike {
  const pad = 0x5f;
  console.warn('[overlook] OVERLOOK_INSECURE_KEYSTORE active — dev/test profile only, no real key protection');
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(Buffer.from(plain, 'utf8').map((byte) => byte ^ pad)),
    decryptString: (encrypted) => Buffer.from(encrypted.map((byte) => byte ^ pad)).toString('utf8'),
  };
}

function pickSafeStorage(): SafeStorageLike {
  if (process.env['OVERLOOK_INSECURE_KEYSTORE'] === '1' && !app.isPackaged) {
    return devInsecureKeystore();
  }
  return safeStorage;
}

// Lazy library bootstrap: nothing touches the keychain or the database until
// the renderer's first library.* call (the E2E smoke never does).
let libraryService: LibraryService | undefined;

function broadcast(send: (win: BrowserWindow) => void): void {
  for (const win of BrowserWindow.getAllWindows()) {
    send(win);
  }
}

let libraryParts:
  { db: ReturnType<typeof openLibraryDatabase>; blobStore: BlobStore; blobStoreReady: Promise<void>; keyStore: KeyStore } | undefined;

function getLibraryService(): LibraryService {
  if (libraryService === undefined) {
    const dataDir = path.join(app.getPath('userData'), 'library');
    const keyStore = KeyStore.open({ safeStorage: pickSafeStorage(), dataDir });
    // The DB key is KEY #1: stable across rotation (rotation only moves the
    // blob WRITE key), wrapped by the master key per ADR-0004. A dedicated
    // db-key slot can arrive later via migration if ever needed.
    const dbKey = keyStore.resolver()(1);
    if (dbKey === undefined) {
      throw new Error('library key #1 is missing; cannot key the database');
    }
    const db = openLibraryDatabase({ path: path.join(dataDir, 'library.db'), dbKey });
    const store = new BlobStore({ dataDir });
    // Reads fail clean before init, but WRITES race the directory creation
    // on a fresh profile — importers await this promise (PR #183 review).
    const blobStoreReady = store.init();
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
    libraryParts = { db, blobStore: store, blobStoreReady, keyStore };
    // Retention sweep (#121): once per session when the library first
    // opens — deferred so bootstrap stays sync and the smoke test's
    // lazy-bootstrap stance holds (nothing runs unless the library does).
    setTimeout(() => {
      void getPurgeService()
        .purgeExpired()
        .catch((error: unknown) => {
          console.error('[overlook] retention purge failed', error);
        });
      // Startup lightweight check (#125): repair what is safe, surface the
      // rest as red glyphs via the status the repair writes.
      void consistencyChecker
        ?.repair()
        .then((summary) => {
          const issues =
            summary.orphanOriginals.length + summary.orphanThumbs.length + summary.stagedLeftovers.length + summary.lyingRows.length;
          if (issues > 0) {
            console.warn('[overlook] consistency repair:', JSON.stringify(summary));
          }
        })
        .catch((error: unknown) => {
          console.error('[overlook] consistency check failed', error);
        });
    }, 0);
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

function getFullService(): FullService {
  if (fullService === undefined) {
    getLibraryService();
    const parts = libraryParts;
    if (parts === undefined) {
      throw new Error('library bootstrap failed; full-res service unavailable');
    }
    const repo = new PhotosRepository(parts.db);
    // Configurable decrypted-buffer budget (#91); the FullService default
    // (256 MiB) applies when the env override is absent or not a number.
    const budgetMb = Number(process.env['OVERLOOK_FULL_CACHE_MB'] ?? '');
    fullService = new FullService({
      loadOriginal: async (photoId) => {
        const photo = repo.get(photoId);
        if (photo === undefined) {
          return null;
        }
        if (photo.syncState === 'offloaded') {
          // The ledger, not the filesystem, owns availability: an offloaded
          // original may still exist locally mid-eviction, but it must
          // already render as remote-only (M08 restores it explicitly).
          return null;
        }
        try {
          const stream = parts.blobStore.getStream(photo.contentHash, parts.keyStore.resolver(), photoId);
          return { bytes: await buffer(stream), contentHash: photo.contentHash, fileKind: photo.fileKind };
        } catch (error) {
          if (error instanceof BlobStoreError) {
            return null; // Offloaded or missing original — placeholder.
          }
          throw error;
        }
      },
      maxCacheBytes: Number.isFinite(budgetMb) && budgetMb > 0 ? budgetMb * 1024 * 1024 : undefined,
    });
  }
  return fullService;
}

let settingsStore: SettingsStore | undefined;

function getSettingsStore(): SettingsStore {
  settingsStore ??= new SettingsStore({ filePath: path.join(app.getPath('userData'), 'settings.json') });
  return settingsStore;
}

let backupEngine: BackupEngine | undefined;
let offloadService: OffloadService | undefined;
/** The active provider (a delegator over the registry, #256) — the
 * connection card reads its quota. */
let backupProvider: StorageProvider | undefined;

let providerRuntime: ProviderRuntime | undefined;

/** Provider selection + pCloud custody policy (#256) — logic lives in
 * backup/provider-runtime.ts; only the Electron seams are wired here. */
function getProviderRuntime(): ProviderRuntime {
  providerRuntime ??= new ProviderRuntime({
    dataDir: () => path.join(app.getPath('userData'), 'library'),
    safeStorage: pickSafeStorage,
    openExternal: async (url) => shell.openExternal(url),
    setProviderId: (id) => getSettingsStore().set({ providerId: id }),
    providerId: () => getSettingsStore().get().providerId,
    isPackaged: app.isPackaged,
    harnessEnv,
  });
  return providerRuntime;
}
/** Auto-backup entry point (imports + resume) — set by getBackupEngine. */
let autoBackupTrigger: (() => void) | undefined;
/** Manifest-debt push after deletes (#120/PR #218) — quiet, auto-marked. */
let manifestSyncTrigger: (() => void) | undefined;
let purgeService: PurgeService | undefined;
let consistencyChecker: ConsistencyChecker | undefined;

function getPurgeService(): PurgeService {
  getBackupEngine();
  if (purgeService === undefined) {
    throw new Error('backup bootstrap failed; purge unavailable');
  }
  return purgeService;
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
    const emitPending = createEmitter(events.pendingCountChanged, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    // Provider selection + fault harness live in ProviderRuntime (#256).
    const provider = getProviderRuntime().buildProvider({
      mockRootDir: path.join(app.getPath('userData'), 'library', 'mock-remote'),
      fault: harnessEnv('OVERLOOK_BACKUP_FAULT'),
    });
    backupProvider = provider;
    backupEngine = new BackupEngine({
      provider,
      ledger,
      dirtyPhotos: () => repo.dirtyPhotos(),
      encryptedStream: (hash) => parts.blobStore.getEncryptedStream(hash),
      sealManifest: async (json) => {
        const chunks: Buffer[] = [];
        const encrypt = createEncryptStream(parts.keyStore.currentKey(), { photoId: 'manifest' });
        encrypt.on('data', (chunk: Buffer) => chunks.push(chunk));
        await new Promise<void>((resolve, reject) => {
          encrypt.on('end', resolve);
          encrypt.on('error', reject);
          encrypt.end(Buffer.from(json));
        });
        return Buffer.concat(chunks);
      },
      manifestRows: () => repo.manifestRows(),
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
      events: {
        progress: (done, total, photoId) => {
          emitProgress({ done, total, photoId });
        },
      },
      now: () => Date.now(),
      sleep: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      pendingCountChanged: (count) => {
        emitPending({ count });
      },
      libraryChanged: (photoIds) => {
        emitLibraryChanged({ photoIds: [...photoIds] });
      },
      audit: (line) => {
        void appendFile(auditPath, `${new Date().toISOString()} ${line}\n`).catch(() => undefined);
      },
    });
    offloadService = new OffloadService({
      provider,
      ledger,
      repo: {
        get: (id) => repo.get(id),
        countByContentHash: (hash) => repo.countByContentHash(hash),
      },
      ledgerDirty: (photoId) => ledger.isDirty(photoId),
      blobs: {
        deleteOriginal: async (hash) => parts.blobStore.deleteOriginal(hash),
        hasOriginal: (hash) => parts.blobStore.hasOriginal(hash),
        restoreOriginal: async (hash, ciphertext, photoId) =>
          parts.blobStore.restoreOriginal(hash, ciphertext, parts.keyStore.resolver(), photoId),
      },
      libraryChanged: (photoIds) => {
        emitLibraryChanged({ photoIds: [...photoIds] });
      },
      audit: (line) => {
        void appendFile(auditPath, `${new Date().toISOString()} ${line}\n`).catch(() => undefined);
      },
    });
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
      // Purging changes manifestRows() — same owed-generation rule (and
      // quiet push) as soft delete (PR #218 review).
      oweManifest: () => manifestSyncTrigger?.(),
      libraryChanged: (photoIds) => {
        emitLibraryChanged({ photoIds: [...photoIds] });
      },
      audit: (line) => {
        void appendFile(auditPath, `${new Date().toISOString()} ${line}\n`).catch(() => undefined);
      },
      now: () => Date.now(),
      sleep: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    consistencyChecker = new ConsistencyChecker({
      rows: () => repo.allRows(),
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
      audit: (line) => {
        void appendFile(auditPath, `${new Date().toISOString()} ${line}\n`).catch(() => undefined);
      },
    });
    // Completion events drive the toasts (#106) and the card's bar clear
    // (#108). `auto` rides along so the renderer keeps automatic successes
    // QUIET — an auto-backup's green toast was racing (and replacing) the
    // import-complete toast (#116); failures stay loud for every trigger.
    const engine = backupEngine;
    const originalRun = engine.run.bind(engine);
    const runAndReport = async (auto: boolean, signal?: AbortSignal): Promise<BackupRunResult> => {
      const result = await originalRun(signal);
      if (result.skipped === null) {
        emitCompleted({ uploaded: result.uploaded, failed: result.failed, manifestUploaded: result.manifestUploaded, auto });
      }
      return result;
    };
    engine.run = (signal?: AbortSignal) => runAndReport(false, signal);
    // The auto-backup trigger (#105/#111): same single-flight run, marked
    // auto for the quiet-success rule above.
    autoBackupTrigger = () => {
      const current = getSettingsStore().get();
      if (current.autoBackupOnImport && getProviderRuntime().activeId() !== null) {
        void runAndReport(true).catch(() => undefined);
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

let exportFacade: ExportFacade | undefined;

function getExportFacade(): ExportFacade {
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
    const engine = new ExportEngine({
      repo: { get: (id) => repo.get(id) },
      blobs: parts.blobStore,
      resolveKey: parts.keyStore.resolver(),
      writeFile: writeFileCleanly,
      exists: async (filePath) =>
        access(filePath).then(
          () => true,
          () => false,
        ),
      freeBytes: async (dir) => {
        const stats = await statfs(dir);
        return stats.bavail * stats.bsize;
      },
      joinPath: (dir, name) => path.join(dir, name),
      transcodeJpeg: transcodeToJpeg,
      bufferStream: async (stream) => buffer(stream),
      events: {
        progress: (done, total) => {
          emitProgress({ done, total });
        },
      },
    });
    // One run at a time: overlapping export:run calls would clobber the
    // cancel slot and race on destination filenames (PR #194 review).
    let controller: AbortController | null = null;
    let turn: Promise<unknown> = Promise.resolve();
    exportFacade = {
      run: (photoIds, destination, format) => {
        const task = async (): Promise<{ exported: number; failed: number; cancelled: number; previewTranscodes: number }> => {
          controller = new AbortController();
          try {
            const summary = await engine.exportPhotos(photoIds, destination, controller.signal, format);
            return {
              exported: summary.exported,
              failed: summary.failed,
              cancelled: summary.cancelled,
              previewTranscodes: summary.previewTranscodes,
            };
          } finally {
            controller = null;
          }
        };
        const next = turn.then(task, task);
        turn = next.then(
          () => undefined,
          () => undefined,
        );
        return next;
      },
      cancel: () => {
        controller?.abort();
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
    };
  }
  return exportFacade;
}

function createWindow(): void {
  // Dev runs use the raw Electron binary whose stock icon would sit in the
  // dock/taskbar; point it at the product icon (#236). Packaged builds get
  // their icon from the bundle resources (electron-builder), and build/ is
  // not shipped, so this is dev-only by construction.
  const devIcon = app.isPackaged ? undefined : path.join(import.meta.dirname, '../../build/icon.png');
  if (devIcon !== undefined && process.platform === 'darwin') {
    app.dock?.setIcon(devIcon);
  }
  const win = new BrowserWindow({
    ...(devIcon !== undefined && process.platform !== 'darwin' ? { icon: devIcon } : {}),
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    // Design --gray-0 — paints the frame before the renderer does, so no
    // white flash on launch.
    backgroundColor: '#050708',
    // Frameless chrome (#50): mac keeps native traffic lights over the
    // renderer's reserved 30px strip; win/linux get no OS frame at all and
    // drive minimize/maximize/close over IPC.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : { frame: false }),
    webPreferences: {
      // The preload bundle is CJS (.cjs): sandboxed renderers cannot load ESM
      // preloads, and sandbox stays on as a day-one security default.
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const emitFocusChanged = createEmitter(events.focusChanged, (name, payload) => {
    win.webContents.send(name, payload);
  });
  win.on('focus', () => {
    emitFocusChanged({ focused: true });
  });
  win.on('blur', () => {
    emitFocusChanged({ focused: false });
  });

  // electron-vite sets ELECTRON_RENDERER_URL only in dev (HMR server); packaged
  // and `electron-vite preview` runs load the built renderer from disk.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl !== undefined) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(async () => {
  registerIpcHandlers();
  registerLibraryHandlers(getLibraryService, () => {
    // Soft delete of a synced row leaves pendingCount at 0 with a STALE
    // remote manifest — a restore-from-backup would resurrect the photo
    // (PR #218 review). Owe the generation and push it quietly now; if
    // disconnected/offline the debt persists into the next run.
    getBackupEngine();
    manifestSyncTrigger?.();
  });
  registerAlbumHandlers(getLibraryService, ulid);
  registerThumbProtocol(getThumbService);
  registerFullProtocol(getFullService);
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
  // Recovery key (#240): export needs the opened keystore; IMPORT must work
  // even when the library cannot bootstrap — the restore scenario is
  // exactly the one where KeyStore.open fails on the copied dir.
  registerKeysHandlers(() => ({
    fingerprint: () => {
      getLibraryService();
      const keyStore = libraryParts?.keyStore;
      if (keyStore === undefined) {
        throw new Error('library bootstrap failed; no key to fingerprint');
      }
      return fingerprintOf(keyStore.masterKeyBytes());
    },
    exportKey: async (password) => {
      getLibraryService();
      const keyStore = libraryParts?.keyStore;
      if (keyStore === undefined) {
        throw new Error('library bootstrap failed; no key to export');
      }
      // Harness hook (#240, OVERLOOK_* family): fixed destination instead
      // of the save dialog, mirroring the export/import seams.
      const fixture = harnessEnv('OVERLOOK_KEY_EXPORT_DESTINATION');
      const destination =
        fixture !== undefined && fixture !== ''
          ? fixture
          : await dialog.showSaveDialog({ defaultPath: 'overlook-recovery.key' }).then((r) => (r.canceled ? null : (r.filePath ?? null)));
      if (destination === null) {
        return null;
      }
      // Tiny file, atomic publish: temp + rename (the save dialog already
      // confirmed any overwrite).
      const temp = `${destination}.tmp`;
      await writeFile(temp, sealRecoveryKey(keyStore.masterKeyBytes(), password));
      await rename(temp, destination);
      return destination;
    },
    pickFile: async () => {
      const fixture = harnessEnv('OVERLOOK_KEY_IMPORT_SOURCE');
      if (fixture !== undefined && fixture !== '') {
        return fixture;
      }
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Overlook recovery key', extensions: ['key'] }],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    importKey: async (importPath, password) => {
      let data: Buffer;
      try {
        // Exact-size gate BEFORE buffering (security review P2-1): the
        // renderer supplies the path; never allocate an arbitrary file.
        const stats = await stat(importPath);
        if (!stats.isFile() || stats.size !== RECOVERY_FILE_LENGTH) {
          return { installed: false, fingerprint: null, reason: 'invalid' as const };
        }
        data = await readFile(importPath);
      } catch {
        return { installed: false, fingerprint: null, reason: 'invalid' as const };
      }
      try {
        const master = openRecoveryKey(data, password);
        const dataDir = path.join(app.getPath('userData'), 'library');
        const result = installRecoveredMaster(dataDir, pickSafeStorage(), master);
        if (result === 'mismatch' || result === 'no-library') {
          return { installed: false, fingerprint: null, reason: result };
        }
        return { installed: true, fingerprint: fingerprintOf(master), reason: null };
      } catch (error) {
        const reason = error instanceof RecoveryError ? error.reason : ('invalid' as const);
        return { installed: false, fingerprint: null, reason };
      }
    },
  }));
  registerPurgeHandlers(() => ({
    purge: async (photoIds) => getPurgeService().purge(photoIds),
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
  registerBackupHandlers(() => {
    getBackupEngine();
    const offload = offloadService;
    if (offload === undefined) {
      throw new Error('backup bootstrap failed');
    }
    return {
      // Disconnected blocks MANUAL runs too (PR #213 review) — the toolbar
      // and retry action must not upload to a provider the user detached.
      run: async () => {
        if (getProviderRuntime().activeId() === null) {
          return { uploaded: 0, failed: 0, skipped: 'disconnected' as const };
        }
        return getBackupEngine().run();
      },
      offload: async (photoIds) => offload.offload(photoIds),
      rehydrate: async (photoId) => offload.rehydrate(photoId),
      // Connection card truth (#114): connected = the user's providerId
      // setting; quota comes live from the provider. A data-call failure
      // (e.g. simulated auth expiry) reports as disconnected, not a crash.
      providerStatus: async () => {
        const providerId = getProviderRuntime().activeId();
        if (providerId === null || backupProvider === undefined) {
          // Disconnected: the card still needs to know WHO Connect targets
          // ("Connect pCloud" in packaged builds, the mock in dev).
          return { provider: getProviderRuntime().defaultTarget(), connected: false, account: null, usedBytes: 0, totalBytes: 0 };
        }
        try {
          const quota = await backupProvider.quota();
          return { provider: providerId, connected: true, account: null, usedBytes: quota.usedBytes, totalBytes: quota.totalBytes };
        } catch {
          return { provider: providerId, connected: false, account: null, usedBytes: 0, totalBytes: 0 };
        }
      },
      // Connect/disconnect (#254): policy lives here, not in the renderer.
      // The mock keeps its instant connect; pCloud runs the OAuth loopback
      // flow (registered by #256 — until then the mock path is the live one).
      connect: async () => {
        if (backupProvider?.id === 'pcloud') {
          return getProviderRuntime().connect();
        }
        getSettingsStore().set({ providerId: 'mock' });
        return { ok: true, reason: null };
      },
      disconnect: () => {
        getSettingsStore().set({ providerId: null });
        // Detaching drops custody too — reconnecting is a fresh handshake.
        getProviderRuntime().tokenStore().clear();
        return Promise.resolve();
      },
    };
  });
  const seedCount = Number(harnessEnv('OVERLOOK_SEED') ?? '0');
  if (Number.isInteger(seedCount) && seedCount > 0) {
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
  if (Number.isInteger(syntheticCount) && syntheticCount > 0) {
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
  void thumbnailPool?.close();
});
