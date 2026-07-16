import { BrowserWindow, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';

import { channels } from '../shared/ipc/channels.js';
import { wrapHandler } from '../shared/ipc/registry.js';
import type { AppSettings, SettingsPatch } from '../shared/settings/settings.js';
import type { ProviderDescriptor } from '../shared/backup/provider-descriptor.js';
import type { RestoreDiscoverResponse, RestoreRunResponse } from '../shared/backup/restore-contract.js';
import type { ImportService } from './import/import-service.js';
import type { LibraryService } from './library/library-service.js';
import type { OffloadPreflight, OffloadSummary, RestoreOriginalsSummary } from './backup/offload.js';

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
export function registerLibraryHandlers(getService: () => LibraryService, onDeleted?: (deleted: number) => void): void {
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
  ipcMain.handle(channels.libraryDelete.name, (_event, request: unknown) =>
    wrapHandler(channels.libraryDelete, ({ photoIds }) => {
      const result = getService().deletePhotos(photoIds);
      // Deleting a SYNCED photo changes the manifest with nothing dirty —
      // the host owes the remote a fresh generation (PR #218 review).
      if (result.deleted > 0) {
        onDeleted?.(result.deleted);
      }
      return result;
    })(request),
  );
  ipcMain.handle(channels.libraryRestore.name, (_event, request: unknown) =>
    wrapHandler(channels.libraryRestore, ({ photoIds }) => getService().restorePhotos(photoIds))(request),
  );
}

export function registerAlbumHandlers(getService: () => LibraryService, newId: () => string): void {
  ipcMain.handle(channels.albumCreate.name, (_event, request: unknown) =>
    wrapHandler(channels.albumCreate, ({ name }) => ({ album: getService().createAlbum(newId(), name) }))(request),
  );
  ipcMain.handle(channels.albumRename.name, (_event, request: unknown) =>
    wrapHandler(channels.albumRename, ({ albumId, name }) => {
      getService().renameAlbum(albumId, name);
      return {};
    })(request),
  );
  ipcMain.handle(channels.albumDelete.name, (_event, request: unknown) =>
    wrapHandler(channels.albumDelete, ({ albumId }) => {
      getService().deleteAlbum(albumId);
      return {};
    })(request),
  );
  ipcMain.handle(channels.albumAddPhotos.name, (_event, request: unknown) =>
    wrapHandler(channels.albumAddPhotos, ({ albumId, photoIds }) => getService().addToAlbum(albumId, photoIds))(request),
  );
  ipcMain.handle(channels.albumRemovePhotos.name, (_event, request: unknown) =>
    wrapHandler(channels.albumRemovePhotos, ({ albumId, photoIds }) => getService().removeFromAlbum(albumId, photoIds))(request),
  );
}

export interface PurgeFacade {
  purge(photoIds: readonly string[]): Promise<{ purged: number; skipped: number; remoteFailures: number }>;
}

export function registerPurgeHandlers(getFacade: () => PurgeFacade): void {
  ipcMain.handle(channels.libraryPurge.name, (_event, request: unknown) =>
    wrapHandler(channels.libraryPurge, async ({ photoIds }) => getFacade().purge(photoIds))(request),
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

export function registerImportHandlers(
  getService: () => ImportService,
  pickFolder: () => Promise<string | null>,
  onImported?: () => void,
): void {
  ipcMain.handle(channels.importListSources.name, (_event, request: unknown) =>
    wrapHandler(channels.importListSources, async () => ({ sources: await getService().listSources() }))(request),
  );
  ipcMain.handle(channels.importScanSource.name, (_event, request: unknown) =>
    wrapHandler(channels.importScanSource, async ({ path }) => getService().scanSource(path))(request),
  );
  ipcMain.handle(channels.importPickFolder.name, (_event, request: unknown) =>
    wrapHandler(channels.importPickFolder, async () => ({ path: await pickFolder() }))(request),
  );
  ipcMain.handle(channels.importScanFiles.name, (_event, request: unknown) =>
    wrapHandler(channels.importScanFiles, async ({ paths }) => getService().scanDropped(paths))(request),
  );
  ipcMain.handle(channels.importRun.name, (_event, request: unknown) =>
    wrapHandler(channels.importRun, async ({ path, files, mode }) => {
      // The zod refinement guarantees exactly one of path/files, and that a
      // files run is copy-only (#237).
      const summary = files !== undefined ? await getService().runFiles(files) : await getService().run(path ?? '', mode);
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

export interface KeysFacade {
  fingerprint(): string;
  exportKey(password: string): Promise<string | null>;
  pickFile(): Promise<string | null>;
  importKey(
    path: string,
    password: string,
  ): Promise<{ installed: boolean; fingerprint: string | null; reason: 'invalid' | 'wrong-password' | 'mismatch' | 'no-library' | null }>;
}

export function registerKeysHandlers(getFacade: () => KeysFacade): void {
  ipcMain.handle(channels.keysStatus.name, (_event, request: unknown) =>
    wrapHandler(channels.keysStatus, () => ({ fingerprint: getFacade().fingerprint() }))(request),
  );
  ipcMain.handle(channels.keysExport.name, (_event, request: unknown) =>
    wrapHandler(channels.keysExport, async ({ password }) => ({ path: await getFacade().exportKey(password) }))(request),
  );
  ipcMain.handle(channels.keysPickFile.name, (_event, request: unknown) =>
    wrapHandler(channels.keysPickFile, async () => ({ path: await getFacade().pickFile() }))(request),
  );
  ipcMain.handle(channels.keysImport.name, (_event, request: unknown) =>
    wrapHandler(channels.keysImport, async ({ path, password }) => getFacade().importKey(path, password))(request),
  );
}

export interface RestoreFacade {
  profileStatus(): { fresh: boolean };
  pickKey(): Promise<string | null>;
  discover(providerId: string, keyPath: string, password: string): Promise<RestoreDiscoverResponse>;
  run(sessionId: string, libraryId: string, allowReplace: boolean): Promise<RestoreRunResponse>;
  cancel(): void;
}

export function registerRestoreHandlers(getFacade: () => RestoreFacade): void {
  ipcMain.handle(channels.restoreProfileStatus.name, (_event, request: unknown) =>
    wrapHandler(channels.restoreProfileStatus, () => getFacade().profileStatus())(request),
  );
  ipcMain.handle(channels.restorePickKey.name, (_event, request: unknown) =>
    wrapHandler(channels.restorePickKey, async () => ({ path: await getFacade().pickKey() }))(request),
  );
  ipcMain.handle(channels.restoreDiscover.name, (_event, request: unknown) =>
    wrapHandler(channels.restoreDiscover, ({ providerId, keyPath, password }) => getFacade().discover(providerId, keyPath, password))(
      request,
    ),
  );
  ipcMain.handle(channels.restoreRun.name, (_event, request: unknown) =>
    wrapHandler(channels.restoreRun, ({ sessionId, libraryId, allowReplace }) => getFacade().run(sessionId, libraryId, allowReplace))(
      request,
    ),
  );
  ipcMain.handle(channels.restoreCancel.name, (_event, request: unknown) =>
    wrapHandler(channels.restoreCancel, () => {
      getFacade().cancel();
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
  run(): Promise<{
    uploaded: number;
    failed: number;
    skipped: 'wifi' | 'disconnected' | null;
    integrity: { checked: number; repaired: number; unrecoverable: number; recoveryRepaired: boolean; failed: boolean };
  }>;
  offloadPreflight(photoIds: readonly string[]): Promise<OffloadPreflight>;
  offload(photoIds: readonly string[]): Promise<OffloadSummary>;
  rehydrate(photoId: string): Promise<void>;
  keepDownloaded(photoId: string): Promise<void>;
  releaseEphemeral(photoId: string): Promise<void>;
  ephemeralStatus(photoId: string): 'fetching' | 'verifying' | 'ready' | 'released' | 'error' | null;
  prepareEphemeral(photoId: string): Promise<'durable' | 'ephemeral'>;
  restoreOriginals(photoIds?: readonly string[]): Promise<RestoreOriginalsSummary>;
  providers(): { providers: readonly ProviderDescriptor[]; defaultProviderId: string };
  providerStatus(providerId: string): Promise<{
    provider: ProviderDescriptor;
    connected: boolean;
    account: string | null;
    usedBytes: number | null;
    totalBytes: number | null;
  }>;
  /** Runs the registered provider's handshake (#254): instant for the mock,
   * the OAuth loopback flow for pCloud. */
  connect(providerId: string): Promise<{ ok: boolean; reason: string | null }>;
  disconnect(providerId: string): Promise<{ ok: boolean; reason: string | null }>;
}

export function registerBackupHandlers(getFacade: () => BackupFacade): void {
  ipcMain.handle(channels.backupRun.name, (_event, request: unknown) =>
    wrapHandler(channels.backupRun, async () => getFacade().run())(request),
  );
  ipcMain.handle(channels.backupOffloadPreflight.name, (_event, request: unknown) =>
    wrapHandler(channels.backupOffloadPreflight, async ({ photoIds }) => getFacade().offloadPreflight(photoIds))(request),
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
  ipcMain.handle(channels.backupKeepDownloaded.name, (_event, request: unknown) =>
    wrapHandler(channels.backupKeepDownloaded, async ({ photoId }) => {
      await getFacade().keepDownloaded(photoId);
      return { ok: true };
    })(request),
  );
  ipcMain.handle(channels.backupReleaseEphemeral.name, (_event, request: unknown) =>
    wrapHandler(channels.backupReleaseEphemeral, async ({ photoId }) => {
      await getFacade().releaseEphemeral(photoId);
      return { ok: true };
    })(request),
  );
  ipcMain.handle(channels.backupEphemeralStatus.name, (_event, request: unknown) =>
    wrapHandler(channels.backupEphemeralStatus, ({ photoId }) => ({ stage: getFacade().ephemeralStatus(photoId) }))(request),
  );
  ipcMain.handle(channels.backupPrepareEphemeral.name, (_event, request: unknown) =>
    wrapHandler(channels.backupPrepareEphemeral, async ({ photoId }) => ({ custody: await getFacade().prepareEphemeral(photoId) }))(
      request,
    ),
  );
  ipcMain.handle(channels.backupRestoreOriginals.name, (_event, request: unknown) =>
    wrapHandler(channels.backupRestoreOriginals, async ({ photoIds }) => getFacade().restoreOriginals(photoIds))(request),
  );
  ipcMain.handle(channels.backupProviders.name, (_event, request: unknown) =>
    wrapHandler(channels.backupProviders, () => getFacade().providers())(request),
  );
  ipcMain.handle(channels.backupProviderStatus.name, (_event, request: unknown) =>
    wrapHandler(channels.backupProviderStatus, async ({ providerId }) => getFacade().providerStatus(providerId))(request),
  );
  ipcMain.handle(channels.backupConnect.name, (_event, request: unknown) =>
    wrapHandler(channels.backupConnect, async ({ providerId }) => getFacade().connect(providerId))(request),
  );
  ipcMain.handle(channels.backupDisconnect.name, (_event, request: unknown) =>
    wrapHandler(channels.backupDisconnect, async ({ providerId }) => getFacade().disconnect(providerId))(request),
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
