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
const importListSources = createInvoker(channels.importListSources, invokeTransport);
const importPickFolder = createInvoker(channels.importPickFolder, invokeTransport);
const keysStatus = createInvoker(channels.keysStatus, invokeTransport);
const keysPickFile = createInvoker(channels.keysPickFile, invokeTransport);
const restoreProfileStatus = createInvoker(channels.restoreProfileStatus, invokeTransport);
const restorePickKey = createInvoker(channels.restorePickKey, invokeTransport);

const overlook: OverlookApi = {
  ping: createInvoker(channels.ping, invokeTransport),
  onFocusChanged: createSubscriber(events.focusChanged, subscribeTransport),
  library: Object.freeze({
    page: createInvoker(channels.libraryPage, invokeTransport),
    get: createInvoker(channels.libraryGet, invokeTransport),
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
