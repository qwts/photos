import { z } from 'zod';
import { providerIdSchema } from '../backup/provider-descriptor.js';

export const CURRENT_DIAGNOSTICS_CONSENT_VERSION = 1 as const;

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
  /** Versioned because consent to the old local-only placeholder cannot
   * silently become consent to a future network recipient. */
  diagnosticsConsentVersion: z.union([z.literal(0), z.literal(CURRENT_DIAGNOSTICS_CONSENT_VERSION)]),
  appLockIdle: z.enum(['1', '5', '15', '30', 'never']),
  lockWhenHidden: z.boolean(),
  /** Connected provider; null = disconnected (backup controls disable). */
  providerId: providerIdSchema.nullable(),
});

/** The settings:set request shape — every key optional, same rules. */
export const settingsPatchSchema = settingsSchema.omit({ diagnosticsConsentVersion: true }).partial().strict();

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
  diagnosticsConsentVersion: 0,
  appLockIdle: '5',
  lockWhenHidden: false,
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
    diagnosticsConsentVersion: settingsSchema.shape.diagnosticsConsentVersion.catch(0),
    appLockIdle: settingsSchema.shape.appLockIdle.catch(defaultSettings.appLockIdle),
    lockWhenHidden: settingsSchema.shape.lockWhenHidden.catch(defaultSettings.lockWhenHidden),
    providerId: settingsSchema.shape.providerId.catch(defaultSettings.providerId),
  })
  .catch(defaultSettings);

export function recoverSettings(raw: unknown): AppSettings {
  const recovered = recoverySchema.parse(raw);
  if (!recovered.shareDiagnostics || recovered.diagnosticsConsentVersion !== CURRENT_DIAGNOSTICS_CONSENT_VERSION) {
    return { ...recovered, shareDiagnostics: false, diagnosticsConsentVersion: 0 };
  }
  return recovered;
}

/** The backup engine's throttle view of the slider: 100 = unlimited. */
export function throttlePercentOf(settings: AppSettings): number | null {
  return settings.bandwidthLimit >= 100 ? null : settings.bandwidthLimit;
}

// Explicit per-key merge: `undefined` in a patch means "unchanged", while
// providerId's real `null` (disconnected) must win — so no spread, no ??
// on the nullable key. The locked key stays literal.
export function mergeSettings(current: AppSettings, patch: SettingsPatch): AppSettings {
  const shareDiagnostics = patch.shareDiagnostics ?? current.shareDiagnostics;
  return {
    sortOrder: patch.sortOrder ?? current.sortOrder,
    appearance: patch.appearance ?? current.appearance,
    thumbnailsOnImport: true,
    autoBackupOnImport: patch.autoBackupOnImport ?? current.autoBackupOnImport,
    reOffloadAfterViewing: patch.reOffloadAfterViewing ?? current.reOffloadAfterViewing,
    importMode: patch.importMode ?? current.importMode,
    wifiOnly: patch.wifiOnly ?? current.wifiOnly,
    bandwidthLimit: patch.bandwidthLimit ?? current.bandwidthLimit,
    shareDiagnostics,
    diagnosticsConsentVersion:
      patch.shareDiagnostics === true
        ? CURRENT_DIAGNOSTICS_CONSENT_VERSION
        : patch.shareDiagnostics === false
          ? 0
          : current.diagnosticsConsentVersion,
    appLockIdle: patch.appLockIdle ?? current.appLockIdle,
    lockWhenHidden: patch.lockWhenHidden ?? current.lockWhenHidden,
    providerId: patch.providerId !== undefined ? patch.providerId : current.providerId,
  };
}
