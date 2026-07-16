import { SettingsStore } from './settings-store.js';
import { app } from 'electron';
import path from 'node:path';

let settingsStore: SettingsStore | undefined;

export function getSettingsStore(): SettingsStore {
  if (settingsStore === undefined) {
    settingsStore = new SettingsStore({ filePath: path.join(app.getPath('userData'), 'settings.json') });
    if (app.isPackaged && settingsStore.get().providerId === 'mock') settingsStore.set({ providerId: null });
  }
  return settingsStore;
}
