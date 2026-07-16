import type { z } from 'zod';

import type { channels, events, FocusChangedPayload, PingRequest, PingResponse } from './channels.js';

type Req<C extends { request: z.ZodType }> = z.input<C['request']>;
type Res<C extends { response: z.ZodType }> = z.output<C['response']>;

// The complete surface preload exposes as `window.overlook`. The renderer
// consumes this as a type only — the implementation lives in src/preload.
export interface OverlookApi {
  readonly ping: (request: PingRequest) => Promise<PingResponse>;
  readonly onFocusChanged: (listener: (payload: FocusChangedPayload) => void) => () => void;
  readonly getPlatform: () => Promise<string>;
  readonly minimizeWindow: () => Promise<void>;
  readonly toggleMaximizeWindow: () => Promise<boolean>;
  readonly closeWindow: () => Promise<void>;
  readonly library: {
    readonly page: (request: Req<typeof channels.libraryPage>) => Promise<Res<typeof channels.libraryPage>>;
    readonly get: (request: Req<typeof channels.libraryGet>) => Promise<Res<typeof channels.libraryGet>>;
    readonly toggleFavorite: (request: Req<typeof channels.libraryToggleFavorite>) => Promise<Res<typeof channels.libraryToggleFavorite>>;
    readonly counts: (request: Req<typeof channels.libraryCounts>) => Promise<Res<typeof channels.libraryCounts>>;
    readonly stats: () => Promise<Res<typeof channels.libraryStats>>;
    readonly albums: () => Promise<Res<typeof channels.libraryAlbums>>;
    readonly delete: (request: Req<typeof channels.libraryDelete>) => Promise<Res<typeof channels.libraryDelete>>;
    readonly restore: (request: Req<typeof channels.libraryRestore>) => Promise<Res<typeof channels.libraryRestore>>;
    readonly purge: (request: Req<typeof channels.libraryPurge>) => Promise<Res<typeof channels.libraryPurge>>;
    readonly onChanged: (listener: (payload: { photoIds: string[] }) => void) => () => void;
    readonly onSyncStateChanged: (
      listener: (payload: { updates: { id: string; syncState: 'local' | 'syncing' | 'synced' | 'offloaded' | 'error' }[] }) => void,
    ) => () => void;
    readonly onStorageChanged: (listener: () => void) => () => void;
    readonly onPendingCountChanged: (listener: (payload: { count: number }) => void) => () => void;
  };
  readonly albums: {
    readonly create: (request: Req<typeof channels.albumCreate>) => Promise<Res<typeof channels.albumCreate>>;
    readonly rename: (request: Req<typeof channels.albumRename>) => Promise<Res<typeof channels.albumRename>>;
    readonly delete: (request: Req<typeof channels.albumDelete>) => Promise<Res<typeof channels.albumDelete>>;
    readonly addPhotos: (request: Req<typeof channels.albumAddPhotos>) => Promise<Res<typeof channels.albumAddPhotos>>;
    readonly removePhotos: (request: Req<typeof channels.albumRemovePhotos>) => Promise<Res<typeof channels.albumRemovePhotos>>;
  };
  readonly backup: {
    readonly run: (request: Req<typeof channels.backupRun>) => Promise<Res<typeof channels.backupRun>>;
    readonly onProgress: (listener: (payload: z.output<typeof events.backupProgress.payload>) => void) => () => void;
    readonly onCompleted: (listener: (payload: z.output<typeof events.backupCompleted.payload>) => void) => () => void;
    readonly offloadPreflight: (
      request: Req<typeof channels.backupOffloadPreflight>,
    ) => Promise<Res<typeof channels.backupOffloadPreflight>>;
    readonly offload: (request: Req<typeof channels.backupOffload>) => Promise<Res<typeof channels.backupOffload>>;
    readonly rehydrate: (request: Req<typeof channels.backupRehydrate>) => Promise<Res<typeof channels.backupRehydrate>>;
    readonly keepDownloaded: (request: Req<typeof channels.backupKeepDownloaded>) => Promise<Res<typeof channels.backupKeepDownloaded>>;
    readonly releaseEphemeral: (
      request: Req<typeof channels.backupReleaseEphemeral>,
    ) => Promise<Res<typeof channels.backupReleaseEphemeral>>;
    readonly ephemeralStatus: (request: Req<typeof channels.backupEphemeralStatus>) => Promise<Res<typeof channels.backupEphemeralStatus>>;
    readonly onEphemeralState: (listener: (payload: z.output<typeof events.ephemeralOriginalState.payload>) => void) => () => void;
    readonly restoreOriginals: (
      request: Req<typeof channels.backupRestoreOriginals>,
    ) => Promise<Res<typeof channels.backupRestoreOriginals>>;
    readonly providers: () => Promise<Res<typeof channels.backupProviders>>;
    readonly providerStatus: (request: Req<typeof channels.backupProviderStatus>) => Promise<Res<typeof channels.backupProviderStatus>>;
    readonly connect: (request: Req<typeof channels.backupConnect>) => Promise<Res<typeof channels.backupConnect>>;
    readonly disconnect: (request: Req<typeof channels.backupDisconnect>) => Promise<Res<typeof channels.backupDisconnect>>;
  };
  readonly export: {
    readonly pickDestination: (request: Req<typeof channels.exportPickDestination>) => Promise<Res<typeof channels.exportPickDestination>>;
    readonly run: (request: Req<typeof channels.exportRun>) => Promise<Res<typeof channels.exportRun>>;
    readonly cancel: (request: Req<typeof channels.exportCancel>) => Promise<Res<typeof channels.exportCancel>>;
    readonly onProgress: (listener: (payload: z.output<typeof events.exportProgress.payload>) => void) => () => void;
  };
  readonly keys: {
    readonly status: () => Promise<Res<typeof channels.keysStatus>>;
    readonly export: (request: Req<typeof channels.keysExport>) => Promise<Res<typeof channels.keysExport>>;
    readonly pickFile: () => Promise<Res<typeof channels.keysPickFile>>;
    readonly import: (request: Req<typeof channels.keysImport>) => Promise<Res<typeof channels.keysImport>>;
  };
  readonly restore: {
    readonly profileStatus: () => Promise<Res<typeof channels.restoreProfileStatus>>;
    readonly pickKey: () => Promise<Res<typeof channels.restorePickKey>>;
    readonly discover: (request: Req<typeof channels.restoreDiscover>) => Promise<Res<typeof channels.restoreDiscover>>;
    readonly run: (request: Req<typeof channels.restoreRun>) => Promise<Res<typeof channels.restoreRun>>;
    readonly cancel: (request: Req<typeof channels.restoreCancel>) => Promise<Res<typeof channels.restoreCancel>>;
    readonly onProgress: (listener: (payload: z.output<typeof events.restoreProgress.payload>) => void) => () => void;
  };
  readonly settings: {
    readonly get: () => Promise<Res<typeof channels.settingsGet>>;
    readonly set: (request: Req<typeof channels.settingsSet>) => Promise<Res<typeof channels.settingsSet>>;
    readonly onChanged: (listener: (payload: z.output<typeof events.settingsChanged.payload>) => void) => () => void;
  };
  readonly import: {
    readonly listSources: () => Promise<Res<typeof channels.importListSources>>;
    readonly scanSource: (request: Req<typeof channels.importScanSource>) => Promise<Res<typeof channels.importScanSource>>;
    readonly pickFolder: () => Promise<Res<typeof channels.importPickFolder>>;
    readonly scanFiles: (request: Req<typeof channels.importScanFiles>) => Promise<Res<typeof channels.importScanFiles>>;
    /** Sandboxed renderers can't read File.path — the preload maps a
     * DataTransfer File to its filesystem path (webUtils) for drops (#237). */
    readonly pathForFile: (file: File) => string;
    readonly run: (request: Req<typeof channels.importRun>) => Promise<Res<typeof channels.importRun>>;
    readonly cancel: (request: Req<typeof channels.importCancel>) => Promise<Res<typeof channels.importCancel>>;
    readonly onScanProgress: (listener: (payload: z.output<typeof events.scanProgress.payload>) => void) => () => void;
    readonly onCopyProgress: (listener: (payload: z.output<typeof events.importCopyProgress.payload>) => void) => () => void;
    readonly onThumbProgress: (listener: (payload: z.output<typeof events.importThumbProgress.payload>) => void) => () => void;
  };
}
