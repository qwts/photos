import type { OverlookApi } from '../../shared/ipc/api.js';

// `window.overlook` is installed by src/preload via contextBridge; this is
// the renderer's typed view of it.
declare global {
  interface Window {
    readonly overlook: OverlookApi;
  }
}

export {};
