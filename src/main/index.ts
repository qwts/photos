import path from 'node:path';
import { buffer } from 'node:stream/consumers';

import { app, BrowserWindow, safeStorage } from 'electron';

import { events } from '../shared/ipc/channels.js';
import { createEmitter } from '../shared/ipc/registry.js';
import { BlobStore, BlobStoreError } from './blobs/blob-store.js';
import { KeyStore } from './crypto/keystore.js';
import { openLibraryDatabase } from './db/database.js';
import { PhotosRepository } from './db/photos-repository.js';
import { registerFullProtocol } from './fullres/full-protocol.js';
import { FullService } from './fullres/full-service.js';
import { ImportService } from './import/import-service.js';
import { registerImportHandlers, registerIpcHandlers, registerLibraryHandlers } from './ipc.js';
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

let libraryParts: { db: ReturnType<typeof openLibraryDatabase>; blobStore: BlobStore; keyStore: KeyStore } | undefined;

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
    void store.init();
    libraryParts = { db, blobStore: store, keyStore };
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

function getImportService(): ImportService {
  if (importService === undefined) {
    getLibraryService();
    const parts = libraryParts;
    if (parts === undefined) {
      throw new Error('library bootstrap failed; import service unavailable');
    }
    const emitScanProgress = createEmitter(events.scanProgress, (name, payload) => {
      broadcast((win) => win.webContents.send(name, payload));
    });
    importService = new ImportService(new PhotosRepository(parts.db), {
      scanProgress: (path, progress) => {
        emitScanProgress({ path, ...progress });
      },
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
