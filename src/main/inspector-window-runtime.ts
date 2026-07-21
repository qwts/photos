import { BrowserWindow, ipcMain } from 'electron';

import { closeInspectorWindow, inspectorWindowSnapshot, openInspectorWindow, updateInspectorWindow } from './app-window.js';
import { registerInspectorWindowHandlerContract } from './inspector-window-handlers.js';

export function registerInspectorWindowHandlers(admitContent: () => void): void {
  registerInspectorWindowHandlerContract({
    admitContent,
    handle: (name, handler) => ipcMain.handle(name, (_event, request: unknown) => handler(request)),
    open: openInspectorWindow,
    update: updateInspectorWindow,
    close: closeInspectorWindow,
    snapshot: inspectorWindowSnapshot,
    sendStep: (name, payload) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(name, payload);
    },
  });
}
