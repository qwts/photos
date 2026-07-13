import { access, appendFile, readFile, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';
import { buffer } from 'node:stream/consumers';

import { app, BrowserWindow, dialog, safeStorage } from 'electron';

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
import { BackupEngine } from './backup/backup-engine.js';
import { FaultInjectingProvider, MockProvider } from './backup/mock-provider.js';
import { OffloadService } from './backup/offload.js';
import { SyncLedger } from './backup/sync-ledger.js';
import { createEncryptStream } from './crypto/envelope.js';
import { ExportEngine, writeFileCleanly } from './export/export-engine.js';
import { transcodeToJpeg } from './export/transcode.js';
import {
  registerBackupHandlers,
  registerExportHandlers,
  registerImportHandlers,
  registerIpcHandlers,
  registerLibraryHandlers,
  type ExportFacade,
} from './ipc.js';
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
const userDataOverride = process.env['OVERLOOK_USER_DATA'];
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
    );
    // Crash-safety (#87): a journaled batch from an interrupted run
    // completes before any new import starts.
    void importService.resume().catch((error: unknown) => {
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

let backupEngine: BackupEngine | undefined;
let offloadService: OffloadService | undefined;

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
    // Until M09's settings surface exists, defaults apply: unlimited
    // bandwidth, no Wi-Fi gate, manual backups only. Electron cannot tell
    // interface types portably — 'unknown' is the recorded heuristic.
    const baseProvider = new MockProvider({ rootDir: path.join(app.getPath('userData'), 'library', 'mock-remote') });
    // Harness hook (#110, OVERLOOK_* family): arm a provider fault for the
    // E2E error-path flows (e.g. OVERLOOK_BACKUP_FAULT=put).
    const faultyProvider = new FaultInjectingProvider(baseProvider);
    const fault = process.env['OVERLOOK_BACKUP_FAULT'];
    if (fault === 'put' || fault === 'verify-mismatch' || fault === 'auth-expired' || fault === 'transient-get') {
      faultyProvider.arm(fault);
    }
    const provider = faultyProvider;
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
      settings: () => ({ throttlePercent: null, wifiOnly: false, autoBackupOnImport: false }),
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
    // Completion events drive the red toast + retry (#106); #108 adds the
    // card. Wrap run() so every trigger reports.
    const engine = backupEngine;
    const originalRun = engine.run.bind(engine);
    engine.run = (signal?: AbortSignal) =>
      originalRun(signal).then((result) => {
        if (result.skipped === null) {
          emitCompleted({ uploaded: result.uploaded, failed: result.failed, manifestUploaded: result.manifestUploaded });
        }
        return result;
      });
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
        const fixture = process.env['OVERLOOK_EXPORT_DESTINATION'];
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
  const win = new BrowserWindow({
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
  registerLibraryHandlers(getLibraryService);
  registerThumbProtocol(getThumbService);
  registerFullProtocol(getFullService);
  registerImportHandlers(getImportService);
  registerExportHandlers(getExportFacade);
  registerBackupHandlers(() => {
    getBackupEngine();
    const offload = offloadService;
    if (offload === undefined) {
      throw new Error('backup bootstrap failed');
    }
    return {
      run: async () => getBackupEngine().run(),
      offload: async (photoIds) => offload.offload(photoIds),
      rehydrate: async (photoId) => offload.rehydrate(photoId),
    };
  });
  const seedCount = Number(process.env['OVERLOOK_SEED'] ?? '0');
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
  const syntheticCount = Number(process.env['OVERLOOK_SEED_SYNTHETIC'] ?? '0');
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
