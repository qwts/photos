import path from 'node:path';

import { app, BrowserWindow } from 'electron';

import { events } from '../shared/ipc/channels.js';
import { createEmitter } from '../shared/ipc/registry.js';
import { registerIpcHandlers } from './ipc.js';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
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
