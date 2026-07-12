import type { FocusChangedPayload, PingRequest, PingResponse } from './channels.js';

// The complete surface preload exposes as `window.overlook`. The renderer
// consumes this as a type only — the implementation lives in src/preload.
export interface OverlookApi {
  readonly ping: (request: PingRequest) => Promise<PingResponse>;
  readonly onFocusChanged: (listener: (payload: FocusChangedPayload) => void) => () => void;
}
