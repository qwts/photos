import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { dialog } from 'electron';

import { events } from '../shared/ipc/channels.js';
import { createEmitter } from '../shared/ipc/registry.js';
import { createBackupFacade, type BackupFacadeOptions } from './backup/backup-facade.js';
import type { FullService } from './fullres/full-service.js';
import { registerFullProtocol } from './fullres/full-protocol.js';
import type { ImportService } from './import/import-service.js';
import { ulid } from './import/ulid.js';
import type { KeyStore } from './crypto/keystore.js';
import { createRecoveryKeyFacade } from './crypto/recovery-key-facade.js';
import { pickRecoveryKeyPath } from './crypto/recovery-key-picker.js';
import type { DrainableExportFacade } from './export/export-runtime.js';
import type { ActivityFacade } from './activity/activity-publication.js';
import {
  registerAlbumHandlers,
  registerActivityHandlers,
  registerBackupHandlers,
  registerDiagnosticsHandlers,
  registerExportHandlers,
  registerImportHandlers,
  registerKeysHandlers,
  registerLibraryHandlers,
  registerLibraryRegistryHandlers,
  type LibraryRegistryFacade,
  registerProtectedAlbumHandlers,
  registerPurgeHandlers,
  registerRestoreHandlers,
  registerSettingsHandlers,
} from './ipc.js';
import type { LibraryService } from './library/library-service.js';
import type { DrainablePurgeFacade } from './library/purge-runtime.js';
import type { ProtectedRuntime } from './library/protected-runtime.js';
import { createRestoreFacade } from './backup/restore-facade.js';
import type { RestoreRuntime } from './backup/restore-runtime.js';
import { getSettingsStore } from './settings/settings-runtime.js';
import { registerThumbProtocol } from './thumbs/thumb-protocol.js';
import type { ThumbService } from './thumbs/thumb-service.js';
import { getDiagnosticsService } from './diagnostics/diagnostics-runtime.js';

export interface AppServicesOptions {
  readonly dataDir: () => string;
  readonly harnessEnv: (name: string) => string | undefined;
  readonly requireContentAccess: () => void;
  readonly allowKeyImport: () => boolean;
  readonly getLibrary: () => LibraryService;
  readonly getActivity: () => ActivityFacade;
  readonly libraries: LibraryRegistryFacade;
  readonly getProtected: () => ProtectedRuntime;
  readonly getThumbs: () => ThumbService;
  readonly getFull: () => FullService;
  readonly getImport: () => ImportService;
  readonly getExport: () => DrainableExportFacade;
  readonly getKeyStore: () => KeyStore;
  readonly safeStorage: Parameters<typeof createRecoveryKeyFacade>[0]['safeStorage'];
  readonly getRestore: () => RestoreRuntime;
  readonly getPurge: () => DrainablePurgeFacade;
  readonly backup: BackupFacadeOptions;
  readonly providerBusy: () => boolean;
  readonly onDeleted: () => void;
  readonly onImported: () => void;
  readonly onImportRendererReady: () => void;
  readonly broadcast: (name: string, payload: unknown) => void;
}

async function pickImportFolder(options: AppServicesOptions): Promise<string | null> {
  const fixture = options.harnessEnv('OVERLOOK_IMPORT_FOLDER');
  if (fixture !== undefined && fixture !== '') return fixture;
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

async function pickKeyExport(options: AppServicesOptions): Promise<string | null> {
  const fixture = options.harnessEnv('OVERLOOK_KEY_EXPORT_DESTINATION');
  if (fixture !== undefined && fixture !== '') return fixture;
  const result = await dialog.showSaveDialog({ defaultPath: 'overlook-recovery.key' });
  return result.canceled ? null : (result.filePath ?? null);
}

async function pickDiagnosticsExport(options: AppServicesOptions): Promise<string | null> {
  const fixture = options.harnessEnv('OVERLOOK_DIAGNOSTICS_EXPORT_DESTINATION');
  if (fixture !== undefined && fixture !== '') return fixture;
  const result = await dialog.showSaveDialog({ defaultPath: 'overlook-diagnostics.jsonl' });
  return result.canceled ? null : (result.filePath ?? null);
}

export function registerAppServices(options: AppServicesOptions): void {
  registerLibraryHandlers(options.getLibrary, options.onDeleted, options.getActivity);
  registerAlbumHandlers(options.getLibrary, ulid, options.getActivity);
  registerActivityHandlers(options.getActivity);
  registerProtectedAlbumHandlers(
    () => options.getProtected().library,
    () => options.getProtected().exports(),
    () => options.getProtected().workflow,
    () => pickRecoveryKeyPath(options.harnessEnv('OVERLOOK_KEY_IMPORT_SOURCE')),
    readFile,
  );
  registerThumbProtocol(options.getThumbs, options.requireContentAccess, () => options.getProtected().media());
  registerFullProtocol(options.getFull, options.requireContentAccess, () => options.getProtected().media());
  registerImportHandlers(
    options.getImport,
    () => pickImportFolder(options),
    options.onImported,
    options.onImportRendererReady,
    options.getActivity,
  );
  registerExportHandlers(options.getExport, options.getActivity);
  registerKeysHandlers(() =>
    createRecoveryKeyFacade({
      keyStore: options.getKeyStore,
      safeStorage: options.safeStorage,
      dataDir: options.dataDir,
      allowImport: options.allowKeyImport,
      pickExportDestination: () => pickKeyExport(options),
      pickImportSource: () => pickRecoveryKeyPath(options.harnessEnv('OVERLOOK_KEY_IMPORT_SOURCE')),
    }),
  );
  registerRestoreHandlers(() =>
    createRestoreFacade({
      coordinator: () => options.getRestore().coordinator,
      fresh: () => !existsSync(path.join(options.dataDir(), 'library.db')),
      pickKey: () => pickRecoveryKeyPath(options.harnessEnv('OVERLOOK_KEY_IMPORT_SOURCE')),
      busy: options.providerBusy,
    }),
  );
  registerPurgeHandlers(() => ({ purge: (photoIds) => options.getPurge().purge(photoIds) }), options.getActivity);
  registerLibraryRegistryHandlers(() => options.libraries);
  registerSettingsHandlers(() => getSettingsStore());
  registerDiagnosticsHandlers(getDiagnosticsService, () => pickDiagnosticsExport(options));
  const emitSettingsChanged = createEmitter(events.settingsChanged, options.broadcast);
  getSettingsStore().subscribe((settings) => emitSettingsChanged({ settings }));
  registerBackupHandlers(() => createBackupFacade(options.backup));
}
