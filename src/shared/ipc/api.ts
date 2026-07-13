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
  readonly backup: {
    readonly run: (request: Req<typeof channels.backupRun>) => Promise<Res<typeof channels.backupRun>>;
    readonly onProgress: (listener: (payload: z.output<typeof events.backupProgress.payload>) => void) => () => void;
    readonly onCompleted: (listener: (payload: z.output<typeof events.backupCompleted.payload>) => void) => () => void;
  };
  readonly export: {
    readonly pickDestination: (request: Req<typeof channels.exportPickDestination>) => Promise<Res<typeof channels.exportPickDestination>>;
    readonly run: (request: Req<typeof channels.exportRun>) => Promise<Res<typeof channels.exportRun>>;
    readonly cancel: (request: Req<typeof channels.exportCancel>) => Promise<Res<typeof channels.exportCancel>>;
    readonly onProgress: (listener: (payload: z.output<typeof events.exportProgress.payload>) => void) => () => void;
  };
  readonly import: {
    readonly listSources: () => Promise<Res<typeof channels.importListSources>>;
    readonly scanSource: (request: Req<typeof channels.importScanSource>) => Promise<Res<typeof channels.importScanSource>>;
    readonly run: (request: Req<typeof channels.importRun>) => Promise<Res<typeof channels.importRun>>;
    readonly cancel: (request: Req<typeof channels.importCancel>) => Promise<Res<typeof channels.importCancel>>;
    readonly onScanProgress: (listener: (payload: z.output<typeof events.scanProgress.payload>) => void) => () => void;
    readonly onCopyProgress: (listener: (payload: z.output<typeof events.importCopyProgress.payload>) => void) => () => void;
    readonly onThumbProgress: (listener: (payload: z.output<typeof events.importThumbProgress.payload>) => void) => () => void;
  };
}
