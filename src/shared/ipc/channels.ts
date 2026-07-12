import { z } from 'zod';

// Central IPC contract registry: every renderer↔main channel and main→renderer
// event is declared here with request/response (or payload) schemas. Main
// registers handlers and preload exposes invokers for exactly this set —
// nothing else crosses the process boundary (#49).

export interface ChannelDefinition<TRequest extends z.ZodType, TResponse extends z.ZodType> {
  readonly name: string;
  readonly request: TRequest;
  readonly response: TResponse;
}

export interface EventDefinition<TPayload extends z.ZodType> {
  readonly name: string;
  readonly payload: TPayload;
}

function defineChannel<TRequest extends z.ZodType, TResponse extends z.ZodType>(
  name: string,
  request: TRequest,
  response: TResponse,
): ChannelDefinition<TRequest, TResponse> {
  return { name, request, response };
}

function defineEvent<TPayload extends z.ZodType>(name: string, payload: TPayload): EventDefinition<TPayload> {
  return { name, payload };
}

const pageCursorSchema = z.object({ sortKey: z.string(), id: z.string() });

const chipFiltersSchema = z.object({
  favorites: z.boolean().optional(),
  raw: z.boolean().optional(),
  offloaded: z.boolean().optional(),
  localOnly: z.boolean().optional(),
});

const sourceFilterSchema = z.enum(['all', 'favorites', 'recent', 'offloaded', 'deleted']);

const photoRecordSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  fileKind: z.enum(['jpeg', 'raw', 'png', 'heic', 'other']),
  width: z.number(),
  height: z.number(),
  bytes: z.number(),
  contentHash: z.string(),
  camera: z.string().nullable(),
  lens: z.string().nullable(),
  iso: z.number().nullable(),
  aperture: z.string().nullable(),
  shutter: z.string().nullable(),
  focalLength: z.number().nullable(),
  takenAt: z.string().nullable(),
  gpsLat: z.number().nullable(),
  gpsLon: z.number().nullable(),
  place: z.string().nullable(),
  importedAt: z.string(),
  importSource: z.string(),
  favorite: z.boolean(),
  keyId: z.number(),
  deletedAt: z.string().nullable(),
  syncState: z.enum(['local', 'syncing', 'synced', 'offloaded']),
});

export const channels = {
  // Demo round-trip channel proving the registry under test; real domain
  // channels (library, import, backup, settings) arrive with their epics.
  ping: defineChannel('demo:ping', z.object({ message: z.string() }), z.object({ echoed: z.string() })),
  // Frameless-window chrome (#50): Windows/Linux draw custom controls, so the
  // renderer drives the window over IPC; mac uses native traffic lights.
  getPlatform: defineChannel('app:get-platform', z.object({}), z.object({ platform: z.string() })),
  windowMinimize: defineChannel('window:minimize', z.object({}), z.object({})),
  windowToggleMaximize: defineChannel('window:toggle-maximize', z.object({}), z.object({ maximized: z.boolean() })),
  windowClose: defineChannel('window:close', z.object({}), z.object({})),
  // Library contract (#71) — the renderer's typed window into the library.
  libraryPage: defineChannel(
    'library:page',
    z.object({
      source: sourceFilterSchema,
      limit: z.number().int().positive().max(500),
      cursor: pageCursorSchema.optional(),
      recentSince: z.string().optional(),
      query: z.string().optional(),
      chips: chipFiltersSchema.optional(),
    }),
    z.object({ photos: z.array(photoRecordSchema).readonly(), nextCursor: pageCursorSchema.nullable() }),
  ),
  libraryGet: defineChannel('library:get', z.object({ id: z.string() }), z.object({ photo: photoRecordSchema.nullable() })),
  libraryToggleFavorite: defineChannel(
    'library:toggle-favorite',
    z.object({ id: z.string() }),
    z.object({ favorite: z.boolean(), pendingCount: z.number().int().nonnegative() }),
  ),
  libraryCounts: defineChannel(
    'library:counts',
    z.object({ recentSince: z.string() }),
    z.object({
      all: z.number(),
      favorites: z.number(),
      recent: z.number(),
      offloaded: z.number(),
      deleted: z.number(),
    }),
  ),
  libraryStats: defineChannel(
    'library:stats',
    z.object({}),
    z.object({ photos: z.number(), bytes: z.number(), pending: z.number().int().nonnegative() }),
  ),
} as const;

export const events = {
  // Main pushes window focus state; also the reference implementation of the
  // main→renderer event pattern (progress events, settings changes later).
  focusChanged: defineEvent('window:focus-changed', z.object({ focused: z.boolean() })),
  // Targeted library pushes (#71) — never refetch-the-world signals.
  libraryChanged: defineEvent('library:changed', z.object({ photoIds: z.array(z.string()) })),
  pendingCountChanged: defineEvent('library:pending-count', z.object({ count: z.number().int().nonnegative() })),
} as const;

export type PingRequest = z.output<typeof channels.ping.request>;
export type PingResponse = z.output<typeof channels.ping.response>;
export type FocusChangedPayload = z.output<typeof events.focusChanged.payload>;
