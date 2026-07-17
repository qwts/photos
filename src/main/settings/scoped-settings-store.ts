import { defaultSettings, mergeSettings, type AppSettings, type SettingsPatch } from '../../shared/settings/settings.js';

export interface ScopedSettingsStoreOptions {
  readonly profileFilePath: string;
  readonly libraryFilePath: () => string;
}

/**
 * Merged settings facade for ADR-0017's profile/library persistence split.
 * The first commit establishes the contract; persistence and migration are
 * implemented in the next slice.
 */
export class ScopedSettingsStore {
  private settings: AppSettings = { ...defaultSettings };
  private readonly listeners = new Set<(settings: AppSettings) => void>();

  constructor(private readonly options: ScopedSettingsStoreOptions) {
    void this.options;
  }

  get(): AppSettings {
    return this.settings;
  }

  set(patch: SettingsPatch): AppSettings {
    this.settings = mergeSettings(this.settings, patch);
    this.emit();
    return this.settings;
  }

  activateLibrary(): AppSettings {
    this.emit();
    return this.settings;
  }

  subscribe(listener: (settings: AppSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.settings);
  }
}
