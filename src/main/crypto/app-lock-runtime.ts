import { AppLockCredentialStore, type CredentialAnchorStore } from './app-lock-credentials.js';
import { AppLockController } from './app-lock-controller.js';
import { createAppLockFacade, type AppLockFacadeOptions } from './app-lock-facade.js';
import { OsCredentialAnchorStore } from './credential-anchor.js';
import type { SafeStorageLike } from './keystore.js';
import { UnlockThrottle } from './unlock-throttle.js';
import { events } from '../../shared/ipc/channels.js';
import { createEmitter } from '../../shared/ipc/registry.js';
import { registerAppLockHandlers } from '../ipc.js';
import { setContentAdmissionGate } from '../ipc.js';
import { registerAppLockLifecycle } from './app-lock-lifecycle.js';
import type { AppSettings } from '../../shared/settings/settings.js';

export { createAppLockFacade } from './app-lock-facade.js';

export interface AppLockRuntimeOptions {
  readonly dataDir: string;
  readonly safeStorage: SafeStorageLike;
  readonly openAuthorized: (masterKey?: Buffer) => void | Promise<void>;
  readonly closeAuthorized: () => void | Promise<void>;
  readonly failClosed: () => void;
  readonly anchorStore?: CredentialAnchorStore;
}

export function createAppLockRuntime(options: AppLockRuntimeOptions): AppLockController {
  return new AppLockController({
    credentials: new AppLockCredentialStore({
      dataDir: options.dataDir,
      anchorStore: options.anchorStore ?? new OsCredentialAnchorStore({ dataDir: options.dataDir }),
      safeStorage: options.safeStorage,
    }),
    throttle: new UnlockThrottle({ dataDir: options.dataDir, safeStorage: options.safeStorage }),
    openAuthorized: options.openAuthorized,
    closeAuthorized: options.closeAuthorized,
    failClosed: options.failClosed,
  });
}

export interface AppLockIpcOptions extends AppLockFacadeOptions {
  readonly send: (name: string, payload: unknown) => void;
  readonly settings: () => Pick<AppSettings, 'appLockIdle' | 'lockWhenHidden'>;
}

export function registerAppLockIpc(options: AppLockIpcOptions): () => void {
  setContentAdmissionGate(() => options.controller.requireContentAccess());
  registerAppLockHandlers(() => createAppLockFacade(options));
  const emit = createEmitter(events.appLockStateChanged, (name, payload) => options.send(name, payload));
  const offState = options.controller.subscribe((snapshot) => emit({ ...snapshot, retryAfterMs: options.controller.retryAfterMs() }));
  const offLifecycle = registerAppLockLifecycle({ controller: options.controller, settings: options.settings });
  return () => {
    offState();
    offLifecycle();
  };
}
