import { contextBridge, ipcRenderer } from 'electron';

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

const overlook: OverlookApi = {
  ping: createInvoker(channels.ping, invokeTransport),
  onFocusChanged: createSubscriber(events.focusChanged, subscribeTransport),
  library: Object.freeze({
    page: createInvoker(channels.libraryPage, invokeTransport),
    get: createInvoker(channels.libraryGet, invokeTransport),
    toggleFavorite: createInvoker(channels.libraryToggleFavorite, invokeTransport),
    counts: createInvoker(channels.libraryCounts, invokeTransport),
    stats: async () => libraryStats({}),
    onChanged: createSubscriber(events.libraryChanged, subscribeTransport),
    onPendingCountChanged: createSubscriber(events.pendingCountChanged, subscribeTransport),
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
