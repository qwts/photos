import { z } from 'zod';

import { settingsPatchSchema, settingsSchema } from '../settings/settings.js';
import { providerDescriptorSchema, providerIdSchema } from '../backup/provider-descriptor.js';
import { restoreDiscoverResponseSchema, restoreProgressSchema, restoreRunResponseSchema } from '../backup/restore-contract.js';

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

const pageCursorSchema = z.object({ sortKey: z.union([z.string(), z.number()]), id: z.string() });

const chipFiltersSchema = z.object({
  favorites: z.boolean().optional(),
  raw: z.boolean().optional(),
  offloaded: z.boolean().optional(),
  localOnly: z.boolean().optional(),
});

const sourceFilterSchema = z.enum(['all', 'favorites', 'recent', 'offloaded', 'deleted']);

const importSourceSchema = z.object({
  path: z.string(),
  label: z.string(),
  kind: z.enum(['volume', 'folder']),
});

const scanSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  newBytes: z.number().int().nonnegative(),
  newRaw: z.number().int().nonnegative(),
  newJpg: z.number().int().nonnegative(),
  newOther: z.number().int().nonnegative(),
});

const syncStatusSchema = z.enum(['local', 'syncing', 'synced', 'offloaded', 'error']);

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
  syncState: syncStatusSchema,
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
      order: z.enum(['date', 'name', 'size']).optional(),
      albumId: z.string().optional(),
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
  libraryAlbums: defineChannel(
    'library:albums',
    z.object({}),
    z.object({ albums: z.array(z.object({ id: z.string(), name: z.string(), count: z.number().int().nonnegative() })).readonly() }),
  ),
  // Soft delete + restore (#120): safe by default — rows move to Recently
  // deleted and come back intact. Purge (the destructive path) is #121.
  libraryDelete: defineChannel(
    'library:delete',
    z.object({ photoIds: z.array(z.string()).min(1) }),
    z.object({ deleted: z.number().int().nonnegative() }),
  ),
  libraryRestore: defineChannel(
    'library:restore',
    z.object({ photoIds: z.array(z.string()).min(1) }),
    z.object({ restored: z.number().int().nonnegative() }),
  ),
  // Permanent purge (#121): destructive-confirmed in the renderer; removes
  // DB row, local blobs, and remote copies (remote last, failures audited
  // as repairable orphans — never a lying local state).
  libraryPurge: defineChannel(
    'library:purge',
    z.object({ photoIds: z.array(z.string()).min(1) }),
    z.object({
      purged: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
      remoteFailures: z.number().int().nonnegative(),
    }),
  ),
  // Albums CRUD (#117): first-class library objects. Deleting an album
  // never deletes photos (Clear-vs-Delete rules); membership edits dirty
  // the ledger (manifest-relevant, ADR-0007).
  albumCreate: defineChannel(
    'album:create',
    z.object({ name: z.string().min(1).max(120) }),
    z.object({ album: z.object({ id: z.string(), name: z.string(), count: z.number().int().nonnegative() }) }),
  ),
  albumRename: defineChannel('album:rename', z.object({ albumId: z.string(), name: z.string().min(1).max(120) }), z.object({})),
  albumDelete: defineChannel('album:delete', z.object({ albumId: z.string() }), z.object({})),
  albumAddPhotos: defineChannel(
    'album:add-photos',
    z.object({ albumId: z.string(), photoIds: z.array(z.string()).min(1) }),
    z.object({ added: z.number().int().nonnegative() }),
  ),
  albumRemovePhotos: defineChannel(
    'album:remove-photos',
    z.object({ albumId: z.string(), photoIds: z.array(z.string()).min(1) }),
    z.object({ removed: z.number().int().nonnegative() }),
  ),
  // Import sources (#84): discovery + the source-card scan. Copying is #87.
  importListSources: defineChannel('import:list-sources', z.object({}), z.object({ sources: z.array(importSourceSchema).readonly() })),
  importScanSource: defineChannel('import:scan-source', z.object({ path: z.string() }), scanSummarySchema),
  // Folder source (#237): the OS directory picker behind the dialog's
  // "Choose a folder" dropzone; null = cancelled.
  importPickFolder: defineChannel('import:pick-folder', z.object({}), z.object({ path: z.string().nullable() })),
  // Dropped files (#237): scan an explicit file list (window drag-and-drop).
  importScanFiles: defineChannel('import:scan-files', z.object({ paths: z.array(z.string()).min(1) }), scanSummarySchema),
  // Import engine (#87, extended by #237): run a batch — a source path
  // (copy or move) or an explicit dropped-file list (always copy: Move is
  // enforced volume-only at the service layer so a user's own files are
  // never deleted).
  importRun: defineChannel(
    'import:run',
    z
      .object({
        path: z.string().optional(),
        files: z.array(z.string()).min(1).optional(),
        mode: z.enum(['copy', 'move']),
      })
      .refine((run) => (run.path === undefined) !== (run.files === undefined), {
        message: 'exactly one of path or files',
      })
      .refine((run) => run.files === undefined || run.mode === 'copy', {
        message: 'dropped-file imports always copy',
      }),
    z.object({
      imported: z.number().int().nonnegative(),
      duplicates: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      cancelled: z.number().int().nonnegative(),
    }),
  ),
  // Cancel semantics (#88): finish the file in flight, keep completed.
  importCancel: defineChannel('import:cancel', z.object({}), z.object({})),
  // Recovery key (#240, ADR-0008): fingerprint + password-encrypted
  // backup/import of the library master key.
  keysStatus: defineChannel('keys:status', z.object({}), z.object({ fingerprint: z.string() })),
  keysExport: defineChannel(
    'keys:export',
    // Main-side floor (security review P3-1): the dialog's strength gate is
    // renderer-side courtesy; the store never seals under a trivial secret.
    z.object({ password: z.string().min(8).max(1024) }),
    // null path = the user cancelled the save dialog.
    z.object({ path: z.string().nullable() }),
  ),
  keysPickFile: defineChannel('keys:pick-file', z.object({}), z.object({ path: z.string().nullable() })),
  keysImport: defineChannel(
    'keys:import',
    z.object({ path: z.string(), password: z.string().min(1).max(1024) }),
    z.object({
      installed: z.boolean(),
      fingerprint: z.string().nullable(),
      reason: z.enum(['invalid', 'wrong-password', 'mismatch', 'no-library']).nullable(),
    }),
  ),
  // Disaster recovery (#290): recovery material stays in main behind an
  // opaque discovery session; renderer receives metadata and typed errors.
  restoreProfileStatus: defineChannel('restore:profile-status', z.object({}), z.object({ fresh: z.boolean() })),
  restorePickKey: defineChannel('restore:pick-key', z.object({}), z.object({ path: z.string().nullable() })),
  restoreDiscover: defineChannel(
    'restore:discover',
    z.object({ providerId: providerIdSchema, keyPath: z.string().min(1), password: z.string().min(1).max(1024) }),
    restoreDiscoverResponseSchema,
  ),
  restoreRun: defineChannel(
    'restore:run',
    z.object({ sessionId: z.string().min(1), libraryId: z.string().min(1), allowReplace: z.boolean() }),
    restoreRunResponseSchema,
  ),
  restoreCancel: defineChannel('restore:cancel', z.object({}), z.object({})),
  // Export engine (#97): decrypt-on-export to a chosen folder.
  exportPickDestination: defineChannel('export:pick-destination', z.object({}), z.object({ path: z.string().nullable() })),
  exportRun: defineChannel(
    'export:run',
    z.object({ photoIds: z.array(z.string()).min(1), destination: z.string(), format: z.enum(['original', 'jpeg']).optional() }),
    z.object({
      exported: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      cancelled: z.number().int().nonnegative(),
      previewTranscodes: z.number().int().nonnegative(),
    }),
  ),
  exportCancel: defineChannel('export:cancel', z.object({}), z.object({})),
  // Backup engine (#105): the toolbar's manual trigger. 'disconnected'
  // (#114): providerId null blocks manual runs too, not just auto-backup.
  backupRun: defineChannel(
    'backup:run',
    z.object({}),
    z.object({
      uploaded: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      skipped: z.enum(['wifi', 'disconnected']).nullable(),
    }),
  ),
  // Offload / rehydrate (#107).
  backupOffload: defineChannel(
    'backup:offload',
    z.object({ photoIds: z.array(z.string()).min(1) }),
    z.object({
      offloaded: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
      freedBytes: z.number().nonnegative(),
    }),
  ),
  backupRehydrate: defineChannel('backup:rehydrate', z.object({ photoId: z.string() }), z.object({ ok: z.boolean() })),
  backupProviders: defineChannel(
    'backup:providers',
    z.object({}),
    z.object({ providers: z.array(providerDescriptorSchema).readonly(), defaultProviderId: providerIdSchema }),
  ),
  // Provider connection card (#114): addressed provider, connection truth,
  // and nullable quota for providers that do not expose it.
  backupProviderStatus: defineChannel(
    'backup:provider-status',
    z.object({ providerId: providerIdSchema }),
    z.object({
      provider: providerDescriptorSchema,
      connected: z.boolean(),
      /** Account label when the provider knows one (pCloud email); the mock
       * has no account and reports null. */
      account: z.string().nullable(),
      usedBytes: z.number().nonnegative().nullable(),
      totalBytes: z.number().nonnegative().nullable(),
    }),
  ),
  // Provider connect/disconnect (#254): connect runs whatever handshake the
  // registered provider needs — the mock connects instantly, pCloud opens
  // the system browser for the OAuth loopback flow. The token never crosses
  // this boundary; the renderer only learns ok/reason.
  backupConnect: defineChannel(
    'backup:connect',
    z.object({ providerId: providerIdSchema }),
    z.object({ ok: z.boolean(), reason: z.string().nullable() }),
  ),
  backupDisconnect: defineChannel(
    'backup:disconnect',
    z.object({ providerId: providerIdSchema }),
    z.object({ ok: z.boolean(), reason: z.string().nullable() }),
  ),
  // Settings store (#111): typed get + validated partial patch. The locked
  // key (thumbnailsOnImport) is a literal, so a patch flipping it rejects
  // at this boundary.
  settingsGet: defineChannel('settings:get', z.object({}), z.object({ settings: settingsSchema })),
  settingsSet: defineChannel('settings:set', z.object({ patch: settingsPatchSchema }), z.object({ settings: settingsSchema })),
  libraryStats: defineChannel(
    'library:stats',
    z.object({}),
    z.object({
      photos: z.number(),
      bytes: z.number(),
      pending: z.number().int().nonnegative(),
      lastBackupAt: z.string().nullable(),
      offloadedBytes: z.number().nonnegative(),
    }),
  ),
} as const;

export const events = {
  // Main pushes window focus state; also the reference implementation of the
  // main→renderer event pattern (progress events, settings changes later).
  focusChanged: defineEvent('window:focus-changed', z.object({ focused: z.boolean() })),
  // Targeted library pushes (#71) — never refetch-the-world signals.
  libraryChanged: defineEvent('library:changed', z.object({ photoIds: z.array(z.string()) })),
  photoSyncStateChanged: defineEvent(
    'library:sync-state-changed',
    z.object({ updates: z.array(z.object({ id: z.string(), syncState: syncStatusSchema })) }),
  ),
  pendingCountChanged: defineEvent('library:pending-count', z.object({ count: z.number().int().nonnegative() })),
  // Progressive scan counts for big cards (#84).
  scanProgress: defineEvent(
    'import:scan-progress',
    scanSummarySchema.extend({ path: z.string(), scanned: z.number().int().nonnegative(), done: z.boolean() }),
  ),
  // The import dialog's two aggregate bars (#87): copy+encrypt+record, then
  // thumbnails — both n/total over the batch.
  importCopyProgress: defineEvent(
    'import:copy-progress',
    z.object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  ),
  importThumbProgress: defineEvent(
    'import:thumb-progress',
    z.object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  ),
  // Export progress (#97): n/total over the batch.
  exportProgress: defineEvent('export:progress', z.object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() })),
  // Backup completion (#106): drives the red toast + retry on failures.
  // `auto` keeps automatic successes quiet (#116) — an auto-backup's green
  // toast must never replace the import-complete toast; failures stay loud.
  backupCompleted: defineEvent(
    'backup:completed',
    z.object({
      uploaded: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      manifestUploaded: z.boolean(),
      auto: z.boolean(),
    }),
  ),
  // Settings changes (#111) push the full snapshot — consumers (dialog,
  // sidebar, backup engine surface) re-render from one truth.
  settingsChanged: defineEvent('settings:changed', z.object({ settings: settingsSchema })),
  // Backup progress (#105): per-item + aggregate for the sidebar card.
  backupProgress: defineEvent(
    'backup:progress',
    z.object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative(), photoId: z.string().nullable() }),
  ),
  restoreProgress: defineEvent('restore:progress', restoreProgressSchema),
} as const;

export type PingRequest = z.output<typeof channels.ping.request>;
export type PingResponse = z.output<typeof channels.ping.response>;
export type FocusChangedPayload = z.output<typeof events.focusChanged.payload>;
