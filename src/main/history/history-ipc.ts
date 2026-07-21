import { ipcMain } from 'electron';

import { channels } from '../../shared/ipc/channels.js';
import { wrapHandler } from '../../shared/ipc/registry.js';
import type { HistoryService } from './history-service.js';

export function registerHistoryHandlers(getHistory: () => HistoryService, requireContentAccess: () => void): void {
  const history = (): HistoryService => {
    requireContentAccess();
    return getHistory();
  };
  ipcMain.handle(channels.historyStatus.name, (_event, request: unknown) =>
    wrapHandler(channels.historyStatus, () => history().status())(request),
  );
  ipcMain.handle(channels.historyUndo.name, (_event, request: unknown) =>
    wrapHandler(channels.historyUndo, ({ requestId }) => history().undo(requestId))(request),
  );
  ipcMain.handle(channels.historyRedo.name, (_event, request: unknown) =>
    wrapHandler(channels.historyRedo, ({ requestId }) => history().redo(requestId))(request),
  );
}
