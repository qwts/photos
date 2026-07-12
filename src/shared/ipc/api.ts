import type { z } from 'zod';

import type { channels, events, FocusChangedPayload, PingRequest, PingResponse } from './channels.js';

type Req<C extends { request: z.ZodType }> = z.input<C['request']>;
type Res<C extends { response: z.ZodType }> = z.output<C['response']>;

// The complete surface preload exposes as `window.overlook`. The renderer
// consumes this as a type only — the implementation lives in src/preload.
export interface OverlookApi {
  readonly ping: (request: PingRequest) => Promise<PingResponse>;
  readonly onFocusChanged: (listener: (payload: FocusChangedPayload) => void) => () => void;
  readonly getPlatform: () => Promise<string>;
  readonly minimizeWindow: () => Promise<void>;
  readonly toggleMaximizeWindow: () => Promise<boolean>;
  readonly closeWindow: () => Promise<void>;
  readonly library: {
    readonly page: (request: Req<typeof channels.libraryPage>) => Promise<Res<typeof channels.libraryPage>>;
    readonly get: (request: Req<typeof channels.libraryGet>) => Promise<Res<typeof channels.libraryGet>>;
    readonly toggleFavorite: (request: Req<typeof channels.libraryToggleFavorite>) => Promise<Res<typeof channels.libraryToggleFavorite>>;
    readonly counts: (request: Req<typeof channels.libraryCounts>) => Promise<Res<typeof channels.libraryCounts>>;
    readonly stats: () => Promise<Res<typeof channels.libraryStats>>;
    readonly albums: () => Promise<Res<typeof channels.libraryAlbums>>;
    readonly onChanged: (listener: (payload: { photoIds: string[] }) => void) => () => void;
    readonly onPendingCountChanged: (listener: (payload: { count: number }) => void) => () => void;
  };
  readonly import: {
    readonly listSources: () => Promise<Res<typeof channels.importListSources>>;
    readonly scanSource: (request: Req<typeof channels.importScanSource>) => Promise<Res<typeof channels.importScanSource>>;
    readonly onScanProgress: (listener: (payload: z.output<typeof events.scanProgress.payload>) => void) => () => void;
  };
}
