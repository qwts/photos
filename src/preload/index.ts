import { contextBridge, ipcRenderer, webUtils } from 'electron';

import type { OverlookApi } from '../shared/ipc/api.js';
import { channels, events } from '../shared/ipc/channels.js';
import { createInvoker, createSubscriber, type SubscribeTransport } from '../shared/ipc/registry.js';

// contextBridge is the only thing that belongs in this process. The renderer
// never sees ipcRenderer — only the typed, schema-validated surface below.

const invokeTransport = (channelName: string, request: unknown): Promise<unknown> => ipcRenderer.invoke(channelName, request);

const subscribeTransport: SubscribeTransport = (eventName, listener) => {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
    listener(payload);
  };
  ipcRenderer.on(eventName, wrapped);
  return () => {
    ipcRenderer.removeListener(eventName, wrapped);
  };
};

const getPlatform = createInvoker(channels.getPlatform, invokeTransport);
const minimizeWindow = createInvoker(channels.windowMinimize, invokeTransport);
const toggleMaximizeWindow = createInvoker(channels.windowToggleMaximize, invokeTransport);
const closeWindow = createInvoker(channels.windowClose, invokeTransport);

const libraryStats = createInvoker(channels.libraryStats, invokeTransport);
const settingsGet = createInvoker(channels.settingsGet, invokeTransport);
const backupProviders = createInvoker(channels.backupProviders, invokeTransport);
const backupProviderStatus = createInvoker(channels.backupProviderStatus, invokeTransport);
const backupConnect = createInvoker(channels.backupConnect, invokeTransport);
const backupDisconnect = createInvoker(channels.backupDisconnect, invokeTransport);
const libraryAlbums = createInvoker(channels.libraryAlbums, invokeTransport);
const protectedAlbumsList = createInvoker(channels.protectedAlbumsList, invokeTransport);
const protectedAlbumPickRecovery = createInvoker(channels.protectedAlbumPickRecovery, invokeTransport);
const protectedAlbumCancelWorkflow = createInvoker(channels.protectedAlbumCancelWorkflow, invokeTransport);
const protectedAlbumExportPickDestination = createInvoker(channels.protectedAlbumExportPickDestination, invokeTransport);
const protectedAlbumExportCancel = createInvoker(channels.protectedAlbumExportCancel, invokeTransport);
const importListSources = createInvoker(channels.importListSources, invokeTransport);
const importPickFolder = createInvoker(channels.importPickFolder, invokeTransport);
const keysStatus = createInvoker(channels.keysStatus, invokeTransport);
const keysPickFile = createInvoker(channels.keysPickFile, invokeTransport);
const restoreProfileStatus = createInvoker(channels.restoreProfileStatus, invokeTransport);
const restorePickKey = createInvoker(channels.restorePickKey, invokeTransport);
const appLockStatus = createInvoker(channels.appLockStatus, invokeTransport);
const appLockNow = createInvoker(channels.appLockNow, invokeTransport);
const appLockPickRecovery = createInvoker(channels.appLockPickRecovery, invokeTransport);
const appLockTouchIdStatus = createInvoker(channels.appLockTouchIdStatus, invokeTransport);
const appLockTouchIdDisable = createInvoker(channels.appLockTouchIdDisable, invokeTransport);
const appLockTouchIdUnlock = createInvoker(channels.appLockTouchIdUnlock, invokeTransport);

const overlook: OverlookApi = {
  ping: createInvoker(channels.ping, invokeTransport),
  onFocusChanged: createSubscriber(events.focusChanged, subscribeTransport),
  appLock: Object.freeze({
    status: async () => appLockStatus({}),
    unlock: createInvoker(channels.appLockUnlock, invokeTransport),
    configure: createInvoker(channels.appLockConfigure, invokeTransport),
    lockNow: async () => appLockNow({}),
    changePassword: createInvoker(channels.appLockChangePassword, invokeTransport),
    remove: createInvoker(channels.appLockRemove, invokeTransport),
    pickRecovery: async () => appLockPickRecovery({}),
    recover: createInvoker(channels.appLockRecover, invokeTransport),
    touchIdStatus: async () => appLockTouchIdStatus({}),
    touchIdEnable: createInvoker(channels.appLockTouchIdEnable, invokeTransport),
    touchIdDisable: async () => appLockTouchIdDisable({}),
    touchIdUnlock: async () => appLockTouchIdUnlock({}),
    onChanged: createSubscriber(events.appLockStateChanged, subscribeTransport),
    onTouchIdChanged: createSubscriber(events.appLockTouchIdChanged, subscribeTransport),
  }),
  library: Object.freeze({
    page: createInvoker(channels.libraryPage, invokeTransport),
    get: createInvoker(channels.libraryGet, invokeTransport),
    repairDimensions: createInvoker(channels.libraryRepairDimensions, invokeTransport),
    toggleFavorite: createInvoker(channels.libraryToggleFavorite, invokeTransport),
    counts: createInvoker(channels.libraryCounts, invokeTransport),
    stats: async () => libraryStats({}),
    albums: async () => libraryAlbums({}),
    delete: createInvoker(channels.libraryDelete, invokeTransport),
    restore: createInvoker(channels.libraryRestore, invokeTransport),
    purge: createInvoker(channels.libraryPurge, invokeTransport),
    onChanged: createSubscriber(events.libraryChanged, subscribeTransport),
    onSyncStateChanged: createSubscriber(events.photoSyncStateChanged, subscribeTransport),
    onStorageChanged: createSubscriber(events.storageChanged, subscribeTransport),
    onPendingCountChanged: createSubscriber(events.pendingCountChanged, subscribeTransport),
  }),
  albums: Object.freeze({
    create: createInvoker(channels.albumCreate, invokeTransport),
    rename: createInvoker(channels.albumRename, invokeTransport),
    delete: createInvoker(channels.albumDelete, invokeTransport),
    addPhotos: createInvoker(channels.albumAddPhotos, invokeTransport),
    removePhotos: createInvoker(channels.albumRemovePhotos, invokeTransport),
    movePhotos: createInvoker(channels.albumMovePhotos, invokeTransport),
  }),
  protectedAlbums: Object.freeze({
    list: async () => protectedAlbumsList({}),
    protect: createInvoker(channels.protectedAlbumProtect, invokeTransport),
    unprotect: createInvoker(channels.protectedAlbumUnprotect, invokeTransport),
    changePassword: createInvoker(channels.protectedAlbumChangePassword, invokeTransport),
    pickRecovery: async () => protectedAlbumPickRecovery({}),
    recover: createInvoker(channels.protectedAlbumRecover, invokeTransport),
    cancelWorkflow: async () => protectedAlbumCancelWorkflow({}),
    unlock: createInvoker(channels.protectedAlbumUnlock, invokeTransport),
    relock: createInvoker(channels.protectedAlbumRelock, invokeTransport),
    summary: createInvoker(channels.protectedAlbumSummary, invokeTransport),
    page: createInvoker(channels.protectedAlbumPage, invokeTransport),
    get: createInvoker(channels.protectedAlbumGet, invokeTransport),
    toggleFavorite: createInvoker(channels.protectedAlbumToggleFavorite, invokeTransport),
    delete: createInvoker(channels.protectedAlbumDelete, invokeTransport),
    restore: createInvoker(channels.protectedAlbumRestore, invokeTransport),
    pickExportDestination: async () => protectedAlbumExportPickDestination({}),
    export: createInvoker(channels.protectedAlbumExportRun, invokeTransport),
    cancelExport: async () => protectedAlbumExportCancel({}),
    onChanged: createSubscriber(events.protectedAlbumsChanged, subscribeTransport),
    onProgress: createSubscriber(events.protectedWorkflowProgress, subscribeTransport),
  }),
  backup: Object.freeze({
    run: createInvoker(channels.backupRun, invokeTransport),
    onProgress: createSubscriber(events.backupProgress, subscribeTransport),
    onCompleted: createSubscriber(events.backupCompleted, subscribeTransport),
    offloadPreflight: createInvoker(channels.backupOffloadPreflight, invokeTransport),
    offload: createInvoker(channels.backupOffload, invokeTransport),
    rehydrate: createInvoker(channels.backupRehydrate, invokeTransport),
    keepDownloaded: createInvoker(channels.backupKeepDownloaded, invokeTransport),
    releaseEphemeral: createInvoker(channels.backupReleaseEphemeral, invokeTransport),
    ephemeralStatus: createInvoker(channels.backupEphemeralStatus, invokeTransport),
    prepareEphemeral: createInvoker(channels.backupPrepareEphemeral, invokeTransport),
    onEphemeralState: createSubscriber(events.ephemeralOriginalState, subscribeTransport),
    restoreOriginals: createInvoker(channels.backupRestoreOriginals, invokeTransport),
    providers: async () => backupProviders({}),
    providerStatus: backupProviderStatus,
    connect: backupConnect,
    disconnect: backupDisconnect,
  }),
  export: Object.freeze({
    pickDestination: createInvoker(channels.exportPickDestination, invokeTransport),
    run: createInvoker(channels.exportRun, invokeTransport),
    cancel: createInvoker(channels.exportCancel, invokeTransport),
    onProgress: createSubscriber(events.exportProgress, subscribeTransport),
  }),
  keys: Object.freeze({
    status: async () => keysStatus({}),
    export: createInvoker(channels.keysExport, invokeTransport),
    pickFile: async () => keysPickFile({}),
    import: createInvoker(channels.keysImport, invokeTransport),
  }),
  restore: Object.freeze({
    profileStatus: async () => restoreProfileStatus({}),
    pickKey: async () => restorePickKey({}),
    discover: createInvoker(channels.restoreDiscover, invokeTransport),
    run: createInvoker(channels.restoreRun, invokeTransport),
    cancel: createInvoker(channels.restoreCancel, invokeTransport),
    onProgress: createSubscriber(events.restoreProgress, subscribeTransport),
  }),
  settings: Object.freeze({
    get: async () => settingsGet({}),
    set: createInvoker(channels.settingsSet, invokeTransport),
    onChanged: createSubscriber(events.settingsChanged, subscribeTransport),
  }),
  import: Object.freeze({
    listSources: async () => importListSources({}),
    scanSource: createInvoker(channels.importScanSource, invokeTransport),
    pickFolder: async () => importPickFolder({}),
    scanFiles: createInvoker(channels.importScanFiles, invokeTransport),
    // The documented sandbox pattern for drag-and-drop paths: the renderer
    // hands the File across the bridge and webUtils resolves it here (#237).
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    run: createInvoker(channels.importRun, invokeTransport),
    cancel: createInvoker(channels.importCancel, invokeTransport),
    onScanProgress: createSubscriber(events.scanProgress, subscribeTransport),
    onCopyProgress: createSubscriber(events.importCopyProgress, subscribeTransport),
    onThumbProgress: createSubscriber(events.importThumbProgress, subscribeTransport),
  }),
  getPlatform: async () => (await getPlatform({})).platform,
  minimizeWindow: async () => {
    await minimizeWindow({});
  },
  toggleMaximizeWindow: async () => (await toggleMaximizeWindow({})).maximized,
  closeWindow: async () => {
    await closeWindow({});
  },
};

contextBridge.exposeInMainWorld('overlook', Object.freeze(overlook));
