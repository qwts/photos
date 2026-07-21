import { channels } from '../../shared/ipc/channels.js';
import { wrapHandler } from '../../shared/ipc/registry.js';
import type { LibraryService } from './library-service.js';
import type { OriginalDeletionService } from './original-deletion-service.js';

type IpcHandler = (event: unknown, request: unknown) => unknown;

export interface IpcHandlerRegistrar {
  readonly handle: (channel: string, handler: IpcHandler) => void;
}

export function registerOriginalPolicyHandlersWith(
  getLibrary: () => LibraryService,
  getService: () => OriginalDeletionService,
  registrar: IpcHandlerRegistrar,
): void {
  registrar.handle(channels.librarySetOriginal.name, (_event, request: unknown) =>
    wrapHandler(channels.librarySetOriginal, ({ photoIds, isOriginal }) => {
      const { changedPhotoIds: _changedPhotoIds, ...result } = getLibrary().setOriginal(photoIds, isOriginal);
      return result;
    })(request),
  );
  registrar.handle(channels.libraryOriginalDeletePreflight.name, (_event, request: unknown) =>
    wrapHandler(channels.libraryOriginalDeletePreflight, ({ photoIds }) => getService().preflight(photoIds))(request),
  );
  registrar.handle(channels.libraryOriginalDeleteAuthorize.name, (_event, request: unknown) =>
    wrapHandler(channels.libraryOriginalDeleteAuthorize, async ({ challengeId, password }) => {
      const result = await getService().authorize(challengeId, password);
      return {
        ok: result.ok,
        reason: result.ok ? null : result.reason,
        retryAfterMs: result.ok ? 0 : (result.retryAfterMs ?? 0),
      };
    })(request),
  );
  registrar.handle(channels.libraryOriginalDeleteCommit.name, (_event, request: unknown) =>
    wrapHandler(channels.libraryOriginalDeleteCommit, ({ challengeId }) => getService().commit(challengeId))(request),
  );
  registrar.handle(channels.libraryOriginalDeleteCancel.name, (_event, request: unknown) =>
    wrapHandler(channels.libraryOriginalDeleteCancel, ({ challengeId }) => {
      getService().cancel(challengeId);
      return {};
    })(request),
  );
}
