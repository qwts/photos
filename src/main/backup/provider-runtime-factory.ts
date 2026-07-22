import path from 'node:path';

import { app, shell } from 'electron';

import { ProviderRuntime } from './provider-runtime.js';
import { pickSafeStorage } from '../crypto/safe-storage-runtime.js';
import { getSettingsStore } from '../settings/settings-runtime.js';
import { createNativeICloudDriveBridge } from './icloud-drive/native-bridge.js';
import { DeterministicICloudDriveBridge } from './icloud-drive/deterministic-bridge.js';

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
  const iCloudDriveBridge =
    deps.harnessEnv('OVERLOOK_ICLOUD_FAKE') === '1'
      ? new DeterministicICloudDriveBridge()
      : createNativeICloudDriveBridge({ platform: process.platform, packaged: app.isPackaged });
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
    googleDriveClientId: () => deps.harnessEnv('OVERLOOK_GOOGLE_DRIVE_CLIENT_ID') ?? null,
    storageTimeoutMs: storageTimeout(deps.harnessEnv('OVERLOOK_PROVIDER_STORAGE_TIMEOUT_MS')),
    iCloudDriveBridge,
  });
}

function storageTimeout(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const milliseconds = Number(value);
  return Number.isInteger(milliseconds) && milliseconds >= 10 && milliseconds <= 30_000 ? milliseconds : undefined;
}
