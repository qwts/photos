import { BrowserWindow, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';

import { channels } from '../shared/ipc/channels.js';
import { wrapHandler } from '../shared/ipc/registry.js';
import type { LibraryService } from './library/library-service.js';

function windowFromEvent(event: IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win === null) {
    throw new Error('window channel invoked from a webContents with no BrowserWindow');
  }
  return win;
}

// Registers a main-process handler for every channel in the registry. Called
// once at startup, before any window exists. Handlers stay thin here; domain
// logic gets its own modules as the epics land.
export function registerLibraryHandlers(getService: () => LibraryService): void {
  const page = (request: unknown): unknown => wrapHandler(channels.libraryPage, (req) => getService().page(req))(request);
  ipcMain.handle(channels.libraryPage.name, (_event, request: unknown) => page(request));
  ipcMain.handle(channels.libraryGet.name, (_event, request: unknown) =>
    wrapHandler(channels.libraryGet, ({ id }) => ({ photo: getService().get(id) ?? null }))(request),
  );
  ipcMain.handle(channels.libraryToggleFavorite.name, (_event, request: unknown) =>
    wrapHandler(channels.libraryToggleFavorite, ({ id }) => getService().toggleFavorite(id))(request),
  );
  ipcMain.handle(channels.libraryCounts.name, (_event, request: unknown) =>
    wrapHandler(channels.libraryCounts, ({ recentSince }) => getService().counts(recentSince))(request),
  );
  ipcMain.handle(channels.libraryStats.name, (_event, request: unknown) =>
    wrapHandler(channels.libraryStats, () => getService().stats())(request),
  );
  ipcMain.handle(channels.libraryAlbums.name, (_event, request: unknown) =>
    wrapHandler(channels.libraryAlbums, () => ({ albums: getService().albums() }))(request),
  );
}

export function registerIpcHandlers(): void {
  const ping = wrapHandler(channels.ping, ({ message }) => ({ echoed: message }));
  ipcMain.handle(channels.ping.name, (_event, request: unknown) => ping(request));

  const getPlatform = wrapHandler(channels.getPlatform, () => ({ platform: process.platform }));
  ipcMain.handle(channels.getPlatform.name, (_event, request: unknown) => getPlatform(request));

  // Window controls need the calling window, so validation wraps a handler
  // built per invocation.
  ipcMain.handle(channels.windowMinimize.name, (event, request: unknown) =>
    wrapHandler(channels.windowMinimize, () => {
      windowFromEvent(event).minimize();
      return {};
    })(request),
  );

  ipcMain.handle(channels.windowToggleMaximize.name, (event, request: unknown) =>
    wrapHandler(channels.windowToggleMaximize, () => {
      const win = windowFromEvent(event);
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
      return { maximized: win.isMaximized() };
    })(request),
  );

  ipcMain.handle(channels.windowClose.name, (event, request: unknown) =>
    wrapHandler(channels.windowClose, () => {
      windowFromEvent(event).close();
      return {};
    })(request),
  );
}
