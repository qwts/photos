import { app, safeStorage } from 'electron';

import { pickSafeStorageImpl } from './safe-storage.js';

export function pickSafeStorage() {
  return pickSafeStorageImpl(safeStorage, app.isPackaged);
}
