import path from 'node:path';

import { app, BrowserWindow, safeStorage } from 'electron';

import { events } from '../shared/ipc/channels.js';
import { createEmitter } from '../shared/ipc/registry.js';
import { BlobStore } from './blobs/blob-store.js';
import { KeyStore } from './crypto/keystore.js';
import { openLibraryDatabase } from './db/database.js';
import { registerIpcHandlers, registerLibraryHandlers } from './ipc.js';
import { LibraryService } from './library/library-service.js';

// Lazy library bootstrap: nothing touches the keychain or the database until
// the renderer's first library.* call (the E2E smoke never does).
let libraryService: LibraryService | undefined;

function broadcast(send: (win: BrowserWindow) => void): void {
  for (const win of BrowserWindow.getAllWindows()) {
    send(win);
  }
}

function getLibraryService(): LibraryService {
  if (libraryService === undefined) {
    const dataDir = path.join(app.getPath('userData'), 'library');
    const keyStore = KeyStore.open({ safeStorage, dataDir });
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

void app.whenReady().then(() => {
  registerIpcHandlers();
  registerLibraryHandlers(getLibraryService);
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
