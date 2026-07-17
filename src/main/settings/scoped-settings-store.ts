import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  combineSettings,
  defaultLibrarySettings,
  hasLegacyLibrarySettings,
  librarySettingsOf,
  mergeSettings,
  patchTouchesLibrary,
  patchTouchesProfile,
  profileSettingsOf,
  recoverLibrarySettings,
  recoverProfileSettings,
  type AppSettings,
  type LibrarySettings,
  type ProfileSettings,
  type SettingsPatch,
} from '../../shared/settings/settings.js';

export interface ScopedSettingsStoreOptions {
  readonly profileFilePath: string;
  readonly libraryFilePath: () => string;
}

export class ScopedSettingsStore {
  private profile: ProfileSettings;
  private library: LibrarySettings = { ...defaultLibrarySettings };
  private activeLibraryFile = '';
  private legacyLibrarySeed: LibrarySettings | null;
  private libraryDirty = false;
  private readonly listeners = new Set<(settings: AppSettings) => void>();

  constructor(private readonly options: ScopedSettingsStoreOptions) {
    const rawProfile = readJson(options.profileFilePath);
    this.profile = recoverProfileSettings(rawProfile);
    this.legacyLibrarySeed = hasLegacyLibrarySettings(rawProfile) ? recoverLibrarySettings(rawProfile) : null;
    this.loadActiveLibrary();
  }

  get(): AppSettings {
    this.ensureActiveLibrary();
    return combineSettings(this.profile, this.library);
  }

  set(patch: SettingsPatch): AppSettings {
    this.ensureActiveLibrary();
    const merged = mergeSettings(combineSettings(this.profile, this.library), patch);
    if (patchTouchesProfile(patch)) {
      this.profile = profileSettingsOf(merged);
      persistJson(this.options.profileFilePath, this.profile);
    }
    if (patchTouchesLibrary(patch)) {
      this.library = librarySettingsOf(merged);
      this.libraryDirty = true;
      this.persistLibraryIfMaterialized();
    }
    this.emit();
    return combineSettings(this.profile, this.library);
  }

  activateLibrary(): AppSettings {
    if (this.options.libraryFilePath() !== this.activeLibraryFile) {
      this.loadActiveLibrary();
      this.emit();
    } else if (this.persistLibraryIfMaterialized()) {
      this.emit();
    }
    return combineSettings(this.profile, this.library);
  }

  subscribe(listener: (settings: AppSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const settings = combineSettings(this.profile, this.library);
    for (const listener of this.listeners) listener(settings);
  }

  private ensureActiveLibrary(): void {
    if (this.options.libraryFilePath() !== this.activeLibraryFile) this.loadActiveLibrary();
  }

  private loadActiveLibrary(): void {
    this.activeLibraryFile = this.options.libraryFilePath();
    const rawLibrary = readJson(this.activeLibraryFile);
    if (rawLibrary !== undefined) {
      this.library = recoverLibrarySettings(rawLibrary);
      this.libraryDirty = false;
      if (this.legacyLibrarySeed !== null) {
        this.legacyLibrarySeed = null;
        persistJson(this.options.profileFilePath, this.profile);
      }
      return;
    }
    if (this.legacyLibrarySeed !== null) {
      this.library = this.legacyLibrarySeed;
      this.libraryDirty = true;
      this.persistLibraryIfMaterialized();
      return;
    }
    this.library = { ...defaultLibrarySettings };
    this.libraryDirty = false;
  }

  /** A fresh profile's virtual default directory must remain absent so cloud
   * restore can authorize an empty target. Hold preferences in memory until
   * the registry materializes a real library directory. */
  private persistLibraryIfMaterialized(): boolean {
    if (!this.libraryDirty) return false;
    if (!existsSync(path.dirname(this.activeLibraryFile))) return false;
    persistJson(this.activeLibraryFile, this.library);
    this.libraryDirty = false;
    if (this.legacyLibrarySeed !== null) {
      this.legacyLibrarySeed = null;
      // Completing the one-time move prevents a library created later from
      // inheriting whichever library happened to own the legacy preferences.
      persistJson(this.options.profileFilePath, this.profile);
    }
    return true;
  }
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function persistJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const staging = `${filePath}.tmp`;
  writeFileSync(staging, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(staging, filePath);
}
