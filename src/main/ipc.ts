import { BrowserWindow, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';

import { channels } from '../shared/ipc/channels.js';
import { wrapHandler } from '../shared/ipc/registry.js';
import type { AppSettings, SettingsPatch } from '../shared/settings/settings.js';
import type { ImportService } from './import/import-service.js';
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

export interface SettingsFacade {
  get(): AppSettings;
  set(patch: SettingsPatch): AppSettings;
}

export function registerSettingsHandlers(getFacade: () => SettingsFacade): void {
  ipcMain.handle(channels.settingsGet.name, (_event, request: unknown) =>
    wrapHandler(channels.settingsGet, () => ({ settings: getFacade().get() }))(request),
  );
  ipcMain.handle(channels.settingsSet.name, (_event, request: unknown) =>
    wrapHandler(channels.settingsSet, ({ patch }) => ({ settings: getFacade().set(patch) }))(request),
  );
}

export function registerImportHandlers(getService: () => ImportService, onImported?: () => void): void {
  ipcMain.handle(channels.importListSources.name, (_event, request: unknown) =>
    wrapHandler(channels.importListSources, async () => ({ sources: await getService().listSources() }))(request),
  );
  ipcMain.handle(channels.importScanSource.name, (_event, request: unknown) =>
    wrapHandler(channels.importScanSource, async ({ path }) => getService().scanSource(path))(request),
  );
  ipcMain.handle(channels.importRun.name, (_event, request: unknown) =>
    wrapHandler(channels.importRun, async ({ path, mode }) => {
      const summary = await getService().run(path, mode);
      // The auto-backup-on-import subscription seam (#105/#111): fires only
      // when the batch actually landed photos.
      if (summary.imported > 0) {
        onImported?.();
      }
      return { imported: summary.imported, duplicates: summary.duplicates, failed: summary.failed, cancelled: summary.cancelled };
    })(request),
  );
  ipcMain.handle(channels.importCancel.name, (_event, request: unknown) =>
    wrapHandler(channels.importCancel, () => {
      getService().cancel();
      return {};
    })(request),
  );
}

export interface ExportFacade {
  run(
    photoIds: readonly string[],
    destination: string,
    format?: 'original' | 'jpeg',
  ): Promise<{ exported: number; failed: number; cancelled: number; previewTranscodes: number }>;
  cancel(): void;
  pickDestination(): Promise<string | null>;
}

export function registerExportHandlers(getFacade: () => ExportFacade): void {
  ipcMain.handle(channels.exportRun.name, (_event, request: unknown) =>
    wrapHandler(channels.exportRun, async ({ photoIds, destination, format }) => getFacade().run(photoIds, destination, format))(request),
  );
  ipcMain.handle(channels.exportCancel.name, (_event, request: unknown) =>
    wrapHandler(channels.exportCancel, () => {
      getFacade().cancel();
      return {};
    })(request),
  );
  ipcMain.handle(channels.exportPickDestination.name, (_event, request: unknown) =>
    wrapHandler(channels.exportPickDestination, async () => ({ path: await getFacade().pickDestination() }))(request),
  );
}

export interface BackupFacade {
  run(): Promise<{ uploaded: number; failed: number; skipped: 'wifi' | null }>;
  offload(photoIds: readonly string[]): Promise<{ offloaded: number; skipped: number; freedBytes: number }>;
  rehydrate(photoId: string): Promise<void>;
}

export function registerBackupHandlers(getFacade: () => BackupFacade): void {
  ipcMain.handle(channels.backupRun.name, (_event, request: unknown) =>
    wrapHandler(channels.backupRun, async () => getFacade().run())(request),
  );
  ipcMain.handle(channels.backupOffload.name, (_event, request: unknown) =>
    wrapHandler(channels.backupOffload, async ({ photoIds }) => getFacade().offload(photoIds))(request),
  );
  ipcMain.handle(channels.backupRehydrate.name, (_event, request: unknown) =>
    wrapHandler(channels.backupRehydrate, async ({ photoId }) => {
      await getFacade().rehydrate(photoId);
      return { ok: true };
    })(request),
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
