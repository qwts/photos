import { ipcMain } from 'electron';

import { channels } from '../../shared/ipc/channels.js';
import { wrapHandler } from '../../shared/ipc/registry.js';
import type { ActivityFacade } from './activity-publication.js';

export function registerActivityHandlers(getActivity: () => ActivityFacade, requireContentAccess: () => void): void {
  ipcMain.handle(channels.activityPage.name, (_event, request: unknown) =>
    wrapHandler(channels.activityPage, ({ limit, cursor }) => {
      requireContentAccess();
      return getActivity().page(limit, cursor);
    })(request),
  );
}
