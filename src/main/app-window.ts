import path from 'node:path';

import { app, BrowserWindow } from 'electron';

import { events } from '../shared/ipc/channels.js';
import { createEmitter } from '../shared/ipc/registry.js';
import { reloadWebContentsForLock, type ReloadableWebContents } from './crypto/renderer-lock-reload.js';

export function createWindow(): void {
  const devIcon = app.isPackaged ? undefined : path.join(import.meta.dirname, '../../build/icon.png');
  if (devIcon !== undefined && process.platform === 'darwin') app.dock?.setIcon(devIcon);
  const win = new BrowserWindow({
    ...(devIcon !== undefined && process.platform !== 'darwin' ? { icon: devIcon } : {}),
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#050708',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : { frame: false }),
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  const emitFocusChanged = createEmitter(events.focusChanged, (name, payload) => win.webContents.send(name, payload));
  win.on('focus', () => emitFocusChanged({ focused: true }));
  win.on('blur', () => emitFocusChanged({ focused: false }));
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl !== undefined) void win.loadURL(devServerUrl);
  else void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'));
}

export function relaunchLocked(): void {
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.relaunch();
  app.exit(0);
}

/** Destroy the current document so decoded media and stale renderer state
 * cannot survive a lock transition. The replacement document boots only the
 * locking/locked surface because main-process authority is already revoked. */
export function reloadContentWindowsForLock(): Promise<void> {
  const contents = BrowserWindow.getAllWindows().map((win) => win.webContents as unknown as ReloadableWebContents);
  return reloadWebContentsForLock(contents);
}
