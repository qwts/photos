import { BrowserWindow, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';

import { channels } from '../shared/ipc/channels.js';
import { wrapHandler as createValidatedHandler } from '../shared/ipc/registry.js';
import type { HandlerErrorReport } from '../shared/ipc/registry.js';
import type { AppSettings, SettingsPatch } from '../shared/settings/settings.js';
import type { LibraryDescriptor } from '../shared/library/registry.js';
import type { ProviderDescriptor } from '../shared/backup/provider-descriptor.js';
import type { RestoreDiscoverResponse, RestoreRunResponse } from '../shared/backup/restore-contract.js';
import type { ImportService } from './import/import-service.js';
import type { LibraryService } from './library/library-service.js';
import type { ProtectedLibraryService } from './library/protected-library-service.js';
import type { ProtectedExportFacade } from './export/protected-export-runtime.js';
import type { ProtectedWorkflowService } from './library/protected-workflow-service.js';
import type { OffloadPreflight, OffloadSummary, RestoreOriginalsSummary } from './backup/offload.js';
import type { AppLockState, AppTouchIdUnlockResult, AppUnlockResult, LockStateSnapshot } from './crypto/app-lock-controller.js';
import type { TouchIdEnableResult, TouchIdStatus } from './crypto/touch-id.js';
import type { DiagnosticEvent } from './diagnostics/event-contract.js';

let contentAdmission = (): void => undefined;

const reportIpcError = ({ channelName, code, error }: HandlerErrorReport): void => {
  console.error(`[overlook] ${code} on ${channelName}`, error);
};

const validateHandler: typeof createValidatedHandler = (channel, handler) =>
  createValidatedHandler(channel, handler, { reportError: reportIpcError });

export function setContentAdmissionGate(gate: () => void): void {
  contentAdmission = gate;
}

const wrapHandler: typeof validateHandler = (channel, handler) =>
  validateHandler(channel, (request) => {
    contentAdmission();
    return handler(request);
  });

export interface AppLockFacade {
  snapshot(): LockStateSnapshot;
  retryAfterMs(): number;
  unlock(password: string): Promise<AppUnlockResult>;
  touchIdStatus(): Promise<TouchIdStatus>;
  touchIdUnlock(): Promise<AppTouchIdUnlockResult>;
  touchIdEnable(password: string): Promise<TouchIdEnableResult>;
  touchIdDisable(): Promise<boolean>;
  configure(password: string): Promise<void>;
  lock(): Promise<void>;
  changePassword(currentPassword: string, nextPassword: string): Promise<boolean>;
  remove(password: string): Promise<boolean>;
  pickRecovery(): Promise<string | null>;
  recover(
    path: string,
    recoveryPassword: string,
    nextPassword: string,
  ): Promise<{
    recovered: boolean;
    reason: 'invalid' | 'wrong-password' | 'mismatch' | null;
  }>;
}

function lockStatus(facade: AppLockFacade): { state: AppLockState; libraryId: string | null; retryAfterMs: number } {
  return { ...facade.snapshot(), retryAfterMs: facade.retryAfterMs() };
}

export function registerAppLockHandlers(getFacade: () => AppLockFacade): void {
  ipcMain.handle(channels.appLockStatus.name, (_event, request: unknown) =>
    validateHandler(channels.appLockStatus, () => lockStatus(getFacade()))(request),
  );
  ipcMain.handle(channels.appLockUnlock.name, (_event, request: unknown) =>
    validateHandler(channels.appLockUnlock, async ({ password }) => {
      const result = await getFacade().unlock(password);
      return {
        ok: result.ok,
        reason: result.ok ? null : result.reason,
        retryAfterMs: result.ok ? 0 : (result.retryAfterMs ?? getFacade().retryAfterMs()),
      };
    })(request),
  );
  ipcMain.handle(channels.appLockConfigure.name, (_event, request: unknown) =>
    validateHandler(channels.appLockConfigure, async ({ password }) => {
      await getFacade().configure(password);
      return lockStatus(getFacade());
    })(request),
  );
  ipcMain.handle(channels.appLockNow.name, (_event, request: unknown) =>
    validateHandler(channels.appLockNow, async () => {
      await getFacade().lock();
      return lockStatus(getFacade());
    })(request),
  );
  ipcMain.handle(channels.appLockChangePassword.name, (_event, request: unknown) =>
    validateHandler(channels.appLockChangePassword, async ({ currentPassword, nextPassword }) => ({
      changed: await getFacade().changePassword(currentPassword, nextPassword),
    }))(request),
  );
  ipcMain.handle(channels.appLockRemove.name, (_event, request: unknown) =>
    validateHandler(channels.appLockRemove, async ({ password }) => ({ removed: await getFacade().remove(password) }))(request),
  );
  ipcMain.handle(channels.appLockPickRecovery.name, (_event, request: unknown) =>
    validateHandler(channels.appLockPickRecovery, async () => ({ path: await getFacade().pickRecovery() }))(request),
  );
  ipcMain.handle(channels.appLockRecover.name, (_event, request: unknown) =>
    validateHandler(channels.appLockRecover, ({ path, recoveryPassword, nextPassword }) =>
      getFacade().recover(path, recoveryPassword, nextPassword),
    )(request),
  );
  ipcMain.handle(channels.appLockTouchIdStatus.name, (_event, request: unknown) =>
    validateHandler(channels.appLockTouchIdStatus, () => getFacade().touchIdStatus())(request),
  );
  ipcMain.handle(channels.appLockTouchIdEnable.name, (_event, request: unknown) =>
    validateHandler(channels.appLockTouchIdEnable, async ({ password }) => {
      const result = await getFacade().touchIdEnable(password);
      return { enabled: result.ok, reason: result.ok ? null : result.reason };
    })(request),
  );
  ipcMain.handle(channels.appLockTouchIdDisable.name, (_event, request: unknown) =>
    validateHandler(channels.appLockTouchIdDisable, async () => ({ disabled: await getFacade().touchIdDisable() }))(request),
  );
  ipcMain.handle(channels.appLockTouchIdUnlock.name, (_event, request: unknown) =>
    validateHandler(channels.appLockTouchIdUnlock, async () => {
      const result = await getFacade().touchIdUnlock();
      return { ok: result.ok, reason: result.ok ? null : result.reason };
    })(request),
  );
}

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
  ipcMain.handle(channels.libraryRepairDimensions.name, (_event, request: unknown) =>
    wrapHandler(channels.libraryRepairDimensions, ({ id, width, height }) => getService().repairDimensions(id, width, height))(request),
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
  ipcMain.handle(channels.albumMovePhotos.name, (_event, request: unknown) =>
    wrapHandler(channels.albumMovePhotos, ({ sourceAlbumId, targetAlbumId, photoIds }) =>
      getService().moveBetweenAlbums(sourceAlbumId, targetAlbumId, photoIds),
    )(request),
  );
}

export function registerProtectedAlbumHandlers(
  getLibrary: () => ProtectedLibraryService,
  getExport: () => ProtectedExportFacade,
  getWorkflow: () => ProtectedWorkflowService,
  pickRecovery: () => Promise<string | null>,
  readRecovery: (path: string) => Promise<Buffer>,
): void {
  ipcMain.handle(channels.protectedAlbumsList.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumsList, () => ({ albums: getLibrary().listOpaque() }))(request),
  );
  ipcMain.handle(channels.protectedAlbumProtect.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumProtect, async ({ albumId, password }) => {
      const result = await getWorkflow().protect(albumId, password);
      return result.ok ? { ok: true, albumId: result.albumId, reason: null } : { ok: false, albumId: null, reason: result.reason };
    })(request),
  );
  ipcMain.handle(channels.protectedAlbumUnprotect.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumUnprotect, async ({ albumId, password }) => {
      const result = await getWorkflow().unprotect(albumId, password);
      return result.ok ? { ok: true, albumId: result.albumId, reason: null } : { ok: false, albumId: null, reason: result.reason };
    })(request),
  );
  ipcMain.handle(channels.protectedAlbumChangePassword.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumChangePassword, async ({ albumId, currentPassword, nextPassword }) => ({
      changed: await getWorkflow().changePassword(albumId, currentPassword, nextPassword),
    }))(request),
  );
  ipcMain.handle(channels.protectedAlbumPickRecovery.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumPickRecovery, async () => ({ path: await pickRecovery() }))(request),
  );
  ipcMain.handle(channels.protectedAlbumRecover.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumRecover, async ({ albumId, path, recoveryPassword, nextPassword }) =>
      getWorkflow().recoverPassword({ albumId, recoveryFile: await readRecovery(path), recoveryPassword, nextPassword }),
    )(request),
  );
  ipcMain.handle(channels.protectedAlbumCancelWorkflow.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumCancelWorkflow, () => ({ cancelled: getWorkflow().cancel() }))(request),
  );
  ipcMain.handle(channels.protectedAlbumUnlock.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumUnlock, async ({ albumId, password }) => {
      const result = await getWorkflow().unlock(albumId, password);
      return result.ok ? { ok: true, outcome: result.outcome } : { ok: false, outcome: null };
    })(request),
  );
  ipcMain.handle(channels.protectedAlbumRelock.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumRelock, ({ albumId }) => ({ relocked: getWorkflow().relock(albumId) }))(request),
  );
  ipcMain.handle(channels.protectedAlbumSummary.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumSummary, ({ albumId }) => getLibrary().summary(albumId))(request),
  );
  ipcMain.handle(channels.protectedAlbumPage.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumPage, (input) => getLibrary().page(input))(request),
  );
  ipcMain.handle(channels.protectedAlbumGet.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumGet, ({ albumId, photoId }) => ({ photo: getLibrary().get(albumId, photoId) }))(request),
  );
  ipcMain.handle(channels.protectedAlbumToggleFavorite.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumToggleFavorite, ({ albumId, photoId }) => getLibrary().toggleFavorite(albumId, photoId))(request),
  );
  ipcMain.handle(channels.protectedAlbumDelete.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumDelete, ({ albumId, photoIds }) => getLibrary().softDelete(albumId, photoIds))(request),
  );
  ipcMain.handle(channels.protectedAlbumRestore.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumRestore, ({ albumId, photoIds }) => getLibrary().restore(albumId, photoIds))(request),
  );
  ipcMain.handle(channels.protectedAlbumExportPickDestination.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumExportPickDestination, async () => ({ path: await getExport().pickDestination() }))(request),
  );
  ipcMain.handle(channels.protectedAlbumExportRun.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumExportRun, ({ albumId, photoIds, destination, format }) =>
      getExport().run(albumId, photoIds, destination, format),
    )(request),
  );
  ipcMain.handle(channels.protectedAlbumExportCancel.name, (_event, request: unknown) =>
    wrapHandler(channels.protectedAlbumExportCancel, () => {
      getExport().cancel();
      return {};
    })(request),
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

export interface DiagnosticsFacade {
  list(): readonly {
    readonly event: Pick<DiagnosticEvent, 'eventId' | 'capturedAt' | 'kind'>;
    readonly payload: string;
    readonly encryptedBytes: number;
  }[];
  remove(eventId: string): boolean;
  purge(): number;
  export(destination: string, eventIds: readonly string[]): number;
}

export interface LibraryRegistryFacade {
  list(): LibraryDescriptor[];
  create(name: string, path: string | null): LibraryDescriptor;
  open(id: string): { library: LibraryDescriptor; requiresRestart: boolean };
  remove(id: string): boolean;
  current(): LibraryDescriptor;
}

// Multi-library registry (#384): registry mutations never require content
// access — the picker must work while the active library is app-locked, and
// none of these expose library content. Uses validateHandler directly.
export function registerLibraryRegistryHandlers(getFacade: () => LibraryRegistryFacade): void {
  ipcMain.handle(channels.libraryRegistryList.name, (_event, request: unknown) =>
    validateHandler(channels.libraryRegistryList, () => ({ libraries: getFacade().list() }))(request),
  );
  ipcMain.handle(channels.libraryRegistryCreate.name, (_event, request: unknown) =>
    validateHandler(channels.libraryRegistryCreate, ({ name, path }) => ({ library: getFacade().create(name, path) }))(request),
  );
  ipcMain.handle(channels.libraryRegistryOpen.name, (_event, request: unknown) =>
    validateHandler(channels.libraryRegistryOpen, ({ id }) => getFacade().open(id))(request),
  );
  ipcMain.handle(channels.libraryRegistryRemove.name, (_event, request: unknown) =>
    validateHandler(channels.libraryRegistryRemove, ({ id }) => ({ removed: getFacade().remove(id) }))(request),
  );
  ipcMain.handle(channels.libraryRegistryCurrent.name, (_event, request: unknown) =>
    validateHandler(channels.libraryRegistryCurrent, () => ({ library: getFacade().current() }))(request),
  );
}

export function registerSettingsHandlers(getFacade: () => SettingsFacade): void {
  ipcMain.handle(channels.settingsGet.name, (_event, request: unknown) =>
    wrapHandler(channels.settingsGet, () => ({ settings: getFacade().get() }))(request),
  );
  ipcMain.handle(channels.settingsSet.name, (_event, request: unknown) =>
    wrapHandler(channels.settingsSet, ({ patch }) => ({ settings: getFacade().set(patch) }))(request),
  );
}

export function registerDiagnosticsHandlers(getFacade: () => DiagnosticsFacade, pickExportDestination: () => Promise<string | null>): void {
  ipcMain.handle(channels.diagnosticsList.name, (_event, request: unknown) =>
    wrapHandler(channels.diagnosticsList, () => ({
      reports: getFacade()
        .list()
        .map(({ event, payload, encryptedBytes }) => ({
          eventId: event.eventId,
          capturedAt: event.capturedAt,
          kind: event.kind,
          payload,
          encryptedBytes,
        })),
    }))(request),
  );
  ipcMain.handle(channels.diagnosticsDelete.name, (_event, request: unknown) =>
    wrapHandler(channels.diagnosticsDelete, ({ eventId }) => ({ deleted: getFacade().remove(eventId) }))(request),
  );
  ipcMain.handle(channels.diagnosticsPurge.name, (_event, request: unknown) =>
    wrapHandler(channels.diagnosticsPurge, () => ({ deleted: getFacade().purge() }))(request),
  );
  ipcMain.handle(channels.diagnosticsExport.name, (_event, request: unknown) =>
    wrapHandler(channels.diagnosticsExport, async ({ eventIds }) => {
      const destination = await pickExportDestination();
      if (destination === null) return { exported: false, count: 0 };
      return { exported: true, count: getFacade().export(destination, eventIds) };
    })(request),
  );
}

export function registerImportHandlers(
  getService: () => ImportService,
  pickFolder: () => Promise<string | null>,
  onImported?: () => void,
  onExternalReady?: () => void,
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
  ipcMain.handle(channels.importExternalReady.name, (_event, request: unknown) =>
    wrapHandler(channels.importExternalReady, () => {
      onExternalReady?.();
      return {};
    })(request),
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
  /** Runs the addressed provider's instant or interactive handshake. */
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
  const ping = validateHandler(channels.ping, ({ message }) => ({ echoed: message }));
  ipcMain.handle(channels.ping.name, (_event, request: unknown) => ping(request));

  const getPlatform = validateHandler(channels.getPlatform, () => ({ platform: process.platform }));
  ipcMain.handle(channels.getPlatform.name, (_event, request: unknown) => getPlatform(request));

  // Window controls need the calling window, so validation wraps a handler
  // built per invocation.
  ipcMain.handle(channels.windowMinimize.name, (event, request: unknown) =>
    validateHandler(channels.windowMinimize, () => {
      windowFromEvent(event).minimize();
      return {};
    })(request),
  );

  ipcMain.handle(channels.windowToggleMaximize.name, (event, request: unknown) =>
    validateHandler(channels.windowToggleMaximize, () => {
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
    validateHandler(channels.windowClose, () => {
      windowFromEvent(event).close();
      return {};
    })(request),
  );
}
