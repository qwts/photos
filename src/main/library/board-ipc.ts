import { ipcMain } from 'electron';

import { channels } from '../../shared/ipc/channels.js';
import type { wrapHandler as createValidatedHandler } from '../../shared/ipc/registry.js';
import { mutateWithActivity } from '../activity/activity-publication.js';
import type { ActivityFacade } from '../activity/activity-publication.js';
import { boardLayoutCommand } from '../history/command-drafts.js';
import { serializeBoard } from '../../shared/moodboard/board.js';
import type { LibraryService } from './library-service.js';

// Moodboard persistence IPC (#515 / #694, undo #695). Thin wiring over the board
// repository via LibraryService; `wrapHandler` gates every call on content
// access, so boards are unreachable while the app is locked. A save records one
// undoable layout command per gesture (the renderer coalesces a gesture into a
// single debounced save) through the shared activity history (ADR-0025).
export function registerBoardIpcHandlers(
  getService: () => LibraryService,
  wrapHandler: typeof createValidatedHandler,
  getActivity?: () => ActivityFacade,
  onManifestChanged?: () => void,
): void {
  ipcMain.handle(channels.boardList.name, (_event, request: unknown) =>
    wrapHandler(channels.boardList, () => ({ boards: getService().listBoards() }))(request),
  );
  ipcMain.handle(channels.boardGet.name, (_event, request: unknown) =>
    wrapHandler(channels.boardGet, ({ boardId }) => ({ board: getService().getBoard(boardId) }))(request),
  );
  ipcMain.handle(channels.boardSave.name, (_event, request: unknown) =>
    wrapHandler(channels.boardSave, ({ board }) => {
      const service = getService();
      const before = service.getBoard(board.id);
      const command = boardLayoutCommand(board.id, before === null ? null : serializeBoard(before), serializeBoard(board));
      mutateWithActivity(
        getActivity,
        () => service.saveBoard(board),
        () =>
          command === undefined
            ? undefined
            : { eventType: 'board.layout-changed', entityIds: [board.id], outcome: 'succeeded', payload: {} },
        () => command,
      );
      // Board changes are backup-relevant even though they never dirty the
      // photo ledger; owe a fresh manifest so the next backup captures them.
      onManifestChanged?.();
      return {};
    })(request),
  );
  ipcMain.handle(channels.boardDelete.name, (_event, request: unknown) =>
    wrapHandler(channels.boardDelete, ({ boardId }) => {
      getService().deleteBoard(boardId);
      onManifestChanged?.();
      return {};
    })(request),
  );
}
