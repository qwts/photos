import type { AppLockController } from './app-lock-controller.js';
import { recoverAppLock } from './app-lock-recovery.js';

export interface AppLockFacadeOptions {
  readonly controller: AppLockController;
  readonly currentMaster: () => Buffer;
  readonly libraryId: () => string;
  readonly dataDir: string;
  readonly pickRecovery: () => Promise<string | null>;
}

export function createAppLockFacade(options: AppLockFacadeOptions) {
  return {
    snapshot: () => options.controller.snapshot(),
    retryAfterMs: () => options.controller.retryAfterMs(),
    unlock: (password: string) => options.controller.unlock(password),
    configure: async (password: string) => {
      const masterKey = options.currentMaster();
      try {
        await options.controller.configure({ libraryId: options.libraryId(), password, masterKey });
      } finally {
        masterKey.fill(0);
      }
    },
    lock: () => options.controller.lock(),
    changePassword: (currentPassword: string, nextPassword: string) => options.controller.changePassword(currentPassword, nextPassword),
    remove: (password: string) => options.controller.remove(password),
    pickRecovery: options.pickRecovery,
    recover: (path: string, recoveryPassword: string, nextPassword: string) =>
      recoverAppLock({
        controller: options.controller,
        dataDir: options.dataDir,
        libraryId: options.libraryId(),
        path,
        recoveryPassword,
        nextPassword,
      }),
  };
}
