import { AppLockCredentialStore } from './app-lock-credentials.js';
import { AppLockController } from './app-lock-controller.js';
import { OsCredentialAnchorStore } from './credential-anchor.js';
import type { SafeStorageLike } from './keystore.js';
import { UnlockThrottle } from './unlock-throttle.js';

export interface AppLockRuntimeOptions {
  readonly dataDir: string;
  readonly safeStorage: SafeStorageLike;
  readonly openAuthorized: (masterKey?: Buffer) => void | Promise<void>;
  readonly closeAuthorized: () => void | Promise<void>;
  readonly failClosed: () => void;
}

export function createAppLockRuntime(options: AppLockRuntimeOptions): AppLockController {
  return new AppLockController({
    credentials: new AppLockCredentialStore({
      dataDir: options.dataDir,
      anchorStore: new OsCredentialAnchorStore({ dataDir: options.dataDir }),
      safeStorage: options.safeStorage,
    }),
    throttle: new UnlockThrottle({ dataDir: options.dataDir, safeStorage: options.safeStorage }),
    openAuthorized: options.openAuthorized,
    closeAuthorized: options.closeAuthorized,
    failClosed: options.failClosed,
  });
}
