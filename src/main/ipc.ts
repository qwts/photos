import { ipcMain } from 'electron';

import { channels } from '../shared/ipc/channels.js';
import { wrapHandler } from '../shared/ipc/registry.js';

// Registers a main-process handler for every channel in the registry. Called
// once at startup, before any window exists. Handlers stay thin here; domain
// logic gets its own modules as the epics land.
export function registerIpcHandlers(): void {
  const ping = wrapHandler(channels.ping, ({ message }) => ({ echoed: message }));
  ipcMain.handle(channels.ping.name, (_event, request: unknown) => ping(request));
}
