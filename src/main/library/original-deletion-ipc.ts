import { ipcMain } from 'electron';

import { channels } from '../../shared/ipc/channels.js';
import { wrapHandler } from '../../shared/ipc/registry.js';
import type { LibraryService } from './library-service.js';
import type { OriginalDeletionService } from './original-deletion-service.js';

export function registerOriginalPolicyHandlers(getLibrary: () => LibraryService, getService: () => OriginalDeletionService): void {
  ipcMain.handle(channels.librarySetOriginal.name, (_event, request: unknown) =>
    wrapHandler(channels.librarySetOriginal, ({ photoIds, isOriginal }) => {
      const { changedPhotoIds: _changedPhotoIds, ...result } = getLibrary().setOriginal(photoIds, isOriginal);
      return result;
    })(request),
  );
  ipcMain.handle(channels.libraryOriginalDeletePreflight.name, (_event, request: unknown) =>
    wrapHandler(channels.libraryOriginalDeletePreflight, ({ photoIds }) => getService().preflight(photoIds))(request),
  );
  ipcMain.handle(channels.libraryOriginalDeleteAuthorize.name, (_event, request: unknown) =>
    wrapHandler(channels.libraryOriginalDeleteAuthorize, async ({ challengeId, password }) => {
      const result = await getService().authorize(challengeId, password);
      return {
        ok: result.ok,
        reason: result.ok ? null : result.reason,
        retryAfterMs: result.ok ? 0 : (result.retryAfterMs ?? 0),
      };
    })(request),
  );
  ipcMain.handle(channels.libraryOriginalDeleteCommit.name, (_event, request: unknown) =>
    wrapHandler(channels.libraryOriginalDeleteCommit, ({ challengeId }) => getService().commit(challengeId))(request),
  );
  ipcMain.handle(channels.libraryOriginalDeleteCancel.name, (_event, request: unknown) =>
    wrapHandler(channels.libraryOriginalDeleteCancel, ({ challengeId }) => {
      getService().cancel(challengeId);
      return {};
    })(request),
  );
}
