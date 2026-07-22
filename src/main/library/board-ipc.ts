import { ipcMain } from 'electron';

import { channels } from '../../shared/ipc/channels.js';
import type { wrapHandler as createValidatedHandler } from '../../shared/ipc/registry.js';
import type { LibraryService } from './library-service.js';

// Moodboard persistence IPC (#515 / #694). Thin wiring over the board
// repository via LibraryService; `wrapHandler` gates every call on content
// access, so boards are unreachable while the app is locked. Board edits do not
// go through the activity history yet (undo lands in a later slice).
export function registerBoardIpcHandlers(getService: () => LibraryService, wrapHandler: typeof createValidatedHandler): void {
  ipcMain.handle(channels.boardList.name, (_event, request: unknown) =>
    wrapHandler(channels.boardList, () => ({ boards: getService().listBoards() }))(request),
  );
  ipcMain.handle(channels.boardGet.name, (_event, request: unknown) =>
    wrapHandler(channels.boardGet, ({ boardId }) => ({ board: getService().getBoard(boardId) }))(request),
  );
  ipcMain.handle(channels.boardSave.name, (_event, request: unknown) =>
    wrapHandler(channels.boardSave, ({ board }) => {
      getService().saveBoard(board);
      return {};
    })(request),
  );
  ipcMain.handle(channels.boardDelete.name, (_event, request: unknown) =>
    wrapHandler(channels.boardDelete, ({ boardId }) => {
      getService().deleteBoard(boardId);
      return {};
    })(request),
  );
}
