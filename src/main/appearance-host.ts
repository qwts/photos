import { app, nativeTheme } from 'electron';

import { applyWindowAppearance } from './app-window.js';
import { createAppearanceRuntime } from './appearance-runtime.js';
import type { ScopedSettingsStore } from './settings/scoped-settings-store.js';

export function installAppearanceHost(settings: ScopedSettingsStore): void {
  const runtime = createAppearanceRuntime({ settings, nativeTheme, apply: applyWindowAppearance });
  app.once('will-quit', () => runtime.dispose());
}
