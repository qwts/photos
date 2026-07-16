import { z } from 'zod';
import { providerIdSchema } from '../backup/provider-descriptor.js';

// Typed app settings (#111, epic #44): one source of truth for every knob
// the SettingsDialog surfaces (design SettingsDialog.jsx = the control
// inventory). The schema is the contract — main persists it, the renderer
// renders it, and the backup engine reads throttle/Wi-Fi/auto-backup live.

export const settingsSchema = z.object({
  sortOrder: z.enum(['date', 'name', 'size']),
  /** 'light' exists in the schema but ships disabled — the DS has no light
   * theme yet (recorded on the epic). */
  appearance: z.enum(['dark', 'light']),
  /** Locked true by design: imports always generate thumbnails. */
  thumbnailsOnImport: z.literal(true),
  autoBackupOnImport: z.boolean(),
  /** Keep cloud-only originals temporary after viewing unless the user
   * explicitly chooses permanent local custody. */
  reOffloadAfterViewing: z.boolean(),
  importMode: z.enum(['copy', 'move']),
  wifiOnly: z.boolean(),
  /** Percent of available upload, 10–100; 100 = unlimited. */
  bandwidthLimit: z.number().int().min(10).max(100),
  shareDiagnostics: z.boolean(),
  /** Connected provider; null = disconnected (backup controls disable). */
  providerId: providerIdSchema.nullable(),
});

/** The settings:set request shape — every key optional, same rules. */
export const settingsPatchSchema = settingsSchema.partial();

export type AppSettings = z.output<typeof settingsSchema>;
export type SettingsPatch = z.output<typeof settingsPatchSchema>;

export const defaultSettings: AppSettings = {
  sortOrder: 'date',
  appearance: 'dark',
  thumbnailsOnImport: true,
  autoBackupOnImport: true,
  reOffloadAfterViewing: true,
  importMode: 'copy',
  wifiOnly: true,
  bandwidthLimit: 100,
  shareDiagnostics: false,
  providerId: 'mock',
};

// Per-key recovery: a readable file with one bad value loses only that key
// to its default, never the whole file (#111 exit criteria). Non-object
// input (corrupt JSON parsed to a string, null, …) falls back wholesale.
const recoverySchema = z
  .object({
    sortOrder: settingsSchema.shape.sortOrder.catch(defaultSettings.sortOrder),
    appearance: settingsSchema.shape.appearance.catch(defaultSettings.appearance),
    thumbnailsOnImport: settingsSchema.shape.thumbnailsOnImport.catch(true),
    autoBackupOnImport: settingsSchema.shape.autoBackupOnImport.catch(defaultSettings.autoBackupOnImport),
    reOffloadAfterViewing: settingsSchema.shape.reOffloadAfterViewing.catch(defaultSettings.reOffloadAfterViewing),
    importMode: settingsSchema.shape.importMode.catch(defaultSettings.importMode),
    wifiOnly: settingsSchema.shape.wifiOnly.catch(defaultSettings.wifiOnly),
    bandwidthLimit: settingsSchema.shape.bandwidthLimit.catch(defaultSettings.bandwidthLimit),
    shareDiagnostics: settingsSchema.shape.shareDiagnostics.catch(defaultSettings.shareDiagnostics),
    providerId: settingsSchema.shape.providerId.catch(defaultSettings.providerId),
  })
  .catch(defaultSettings);

export function recoverSettings(raw: unknown): AppSettings {
  return recoverySchema.parse(raw);
}

/** The backup engine's throttle view of the slider: 100 = unlimited. */
export function throttlePercentOf(settings: AppSettings): number | null {
  return settings.bandwidthLimit >= 100 ? null : settings.bandwidthLimit;
}

// Explicit per-key merge: `undefined` in a patch means "unchanged", while
// providerId's real `null` (disconnected) must win — so no spread, no ??
// on the nullable key. The locked key stays literal.
export function mergeSettings(current: AppSettings, patch: SettingsPatch): AppSettings {
  return {
    sortOrder: patch.sortOrder ?? current.sortOrder,
    appearance: patch.appearance ?? current.appearance,
    thumbnailsOnImport: true,
    autoBackupOnImport: patch.autoBackupOnImport ?? current.autoBackupOnImport,
    reOffloadAfterViewing: patch.reOffloadAfterViewing ?? current.reOffloadAfterViewing,
    importMode: patch.importMode ?? current.importMode,
    wifiOnly: patch.wifiOnly ?? current.wifiOnly,
    bandwidthLimit: patch.bandwidthLimit ?? current.bandwidthLimit,
    shareDiagnostics: patch.shareDiagnostics ?? current.shareDiagnostics,
    providerId: patch.providerId !== undefined ? patch.providerId : current.providerId,
  };
}
