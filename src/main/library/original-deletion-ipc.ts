import { ipcMain } from 'electron';

import type { LibraryService } from './library-service.js';
import type { OriginalDeletionService } from './original-deletion-service.js';
import { registerOriginalPolicyHandlersWith } from './original-policy-handlers.js';

export function registerOriginalPolicyHandlers(getLibrary: () => LibraryService, getService: () => OriginalDeletionService): void {
  registerOriginalPolicyHandlersWith(getLibrary, getService, ipcMain);
}
