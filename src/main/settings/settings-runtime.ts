import { app } from 'electron';
import path from 'node:path';

import { ScopedSettingsStore } from './scoped-settings-store.js';
import { installAppearanceHost } from '../appearance-host.js';

let settingsStore: ScopedSettingsStore | undefined;
let libraryDataDir = (): string => path.join(app.getPath('userData'), 'library');
let appearanceHostInstalled = false;

export function configureSettingsLibrary(dataDir: () => string): void {
  libraryDataDir = dataDir;
  if (settingsStore !== undefined) activateSettingsLibrary();
  if (!appearanceHostInstalled) {
    installAppearanceHost(getSettingsStore());
    appearanceHostInstalled = true;
  }
}

export function getSettingsStore(): ScopedSettingsStore {
  if (settingsStore === undefined) {
    settingsStore = new ScopedSettingsStore({
      profileFilePath: path.join(app.getPath('userData'), 'settings.json'),
      libraryFilePath: () => path.join(libraryDataDir(), 'settings.json'),
    });
    if (app.isPackaged && settingsStore.get().providerId === 'mock') settingsStore.set({ providerId: null });
  }
  return settingsStore;
}

export function activateSettingsLibrary(): void {
  const store = getSettingsStore();
  store.activateLibrary();
  // The mock adapter exists only in development/test. Apply the correction
  // for every newly active library, not just the startup library.
  if (app.isPackaged && store.get().providerId === 'mock') store.set({ providerId: null });
}
