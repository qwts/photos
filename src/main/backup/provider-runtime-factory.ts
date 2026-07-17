import path from 'node:path';

import { app, shell } from 'electron';

import { ProviderRuntime } from './provider-runtime.js';
import { pickSafeStorage } from '../crypto/safe-storage-runtime.js';
import { getSettingsStore } from '../settings/settings-runtime.js';

// ProviderRuntime wiring (#256), extracted from the composition root.
// Provider credentials are profile-level (they survive library replacement
// and switches); the library dataDir is a live thunk so the runtime follows
// the active library (#384/#385).

export interface ProviderRuntimeFactoryDeps {
  readonly dataDir: () => string;
  readonly isWorkActive: () => boolean;
  readonly harnessEnv: (name: string) => string | undefined;
}

export function createProviderRuntime(deps: ProviderRuntimeFactoryDeps): ProviderRuntime {
  return new ProviderRuntime({
    dataDir: deps.dataDir,
    providerCredentialDir: (providerId) => path.join(app.getPath('userData'), 'provider-auth', providerId),
    safeStorage: pickSafeStorage,
    openExternal: async (url) => shell.openExternal(url),
    setProviderId: (id) => getSettingsStore().set({ providerId: id }),
    providerId: () => getSettingsStore().get().providerId,
    isWorkActive: deps.isWorkActive,
    isPackaged: app.isPackaged,
    harnessEnv: deps.harnessEnv,
  });
}
