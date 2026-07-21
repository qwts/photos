import { BrowserWindow, ipcMain } from 'electron';

import { channels, events } from '../shared/ipc/channels.js';
import { wrapHandler } from '../shared/ipc/registry.js';
import { closeInspectorWindow, inspectorWindowSnapshot, openInspectorWindow, updateInspectorWindow } from './app-window.js';

export function registerInspectorWindowHandlers(admitContent: () => void): void {
  const validated: typeof wrapHandler = (channel, handler) =>
    wrapHandler(channel, (request) => {
      admitContent();
      return handler(request);
    });

  ipcMain.handle(channels.inspectorWindowOpen.name, (_event, request: unknown) =>
    validated(channels.inspectorWindowOpen, (state) => (openInspectorWindow(state), {}))(request),
  );
  ipcMain.handle(channels.inspectorWindowUpdate.name, (_event, request: unknown) =>
    validated(channels.inspectorWindowUpdate, (state) => (updateInspectorWindow(state), {}))(request),
  );
  ipcMain.handle(channels.inspectorWindowClose.name, (_event, request: unknown) =>
    validated(channels.inspectorWindowClose, () => (closeInspectorWindow(), {}))(request),
  );
  ipcMain.handle(channels.inspectorWindowStep.name, (_event, request: unknown) =>
    validated(channels.inspectorWindowStep, ({ delta }) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(events.inspectorWindowStepRequested.name, { delta });
      return {};
    })(request),
  );
  ipcMain.handle(channels.inspectorWindowSnapshot.name, (_event, request: unknown) =>
    validated(channels.inspectorWindowSnapshot, () => inspectorWindowSnapshot())(request),
  );
}
