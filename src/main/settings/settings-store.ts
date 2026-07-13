import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { defaultSettings, mergeSettings, recoverSettings, type AppSettings, type SettingsPatch } from '../../shared/settings/settings.js';

// Settings persistence (#111): JSON in userData, written atomically
// (tmp + rename — a crash mid-write never truncates the live file). Load
// recovers per-key, so one bad value costs its default, not the file.
// Patches arrive schema-validated from the IPC boundary; every change
// notifies subscribers (the settings:changed push + live engine reads).

export interface SettingsStoreOptions {
  readonly filePath: string;
}

export class SettingsStore {
  private settings: AppSettings;
  private readonly filePath: string;
  private readonly listeners = new Set<(settings: AppSettings) => void>();

  constructor(options: SettingsStoreOptions) {
    this.filePath = options.filePath;
    this.settings = this.load();
  }

  get(): AppSettings {
    return this.settings;
  }

  set(patch: SettingsPatch): AppSettings {
    this.settings = mergeSettings(this.settings, patch);
    this.persist();
    for (const listener of this.listeners) {
      listener(this.settings);
    }
    return this.settings;
  }

  subscribe(listener: (settings: AppSettings) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private load(): AppSettings {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
    } catch {
      // Missing file or unparseable JSON — defaults; per-key recovery
      // below handles a parseable file with bad values.
      return { ...defaultSettings };
    }
    return recoverSettings(raw);
  }

  private persist(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const staging = `${this.filePath}.tmp`;
    writeFileSync(staging, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8');
    renameSync(staging, this.filePath);
  }
}
