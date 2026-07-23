import { app } from 'electron';

import { RestoreRuntime } from './restore-runtime.js';
import { activationOperationsForHarness } from './restore-fault.js';
import type { SafeStorageLike } from '../crypto/keystore.js';

// RestoreRuntime wiring (#291), extracted from the composition root. The
// relaunch after activation is the production path; the harness opts out to
// assert on the activated state in-process.

export interface RestoreRuntimeFactoryOptions {
  readonly targetDir: string;
  readonly safeStorage: () => SafeStorageLike;
  /** May throw when no library keystore is open — normalized to null here. */
  readonly localMasterKey?: (() => Buffer | null) | undefined;
  readonly sources: ConstructorParameters<typeof RestoreRuntime>[0]['sources'];
  readonly sessionId: () => string;
  readonly progress: ConstructorParameters<typeof RestoreRuntime>[0]['progress'];
  readonly beforeActivate: () => Promise<void>;
  readonly harnessEnv: (name: string) => string | undefined;
  readonly workChanged: (delta: 1 | -1) => void;
}

export function createRestoreRuntime(options: RestoreRuntimeFactoryOptions): RestoreRuntime {
  return new RestoreRuntime({
    targetDir: options.targetDir,
    workerUrl: new URL('./thumbnail-worker.js', import.meta.url),
    safeStorage: options.safeStorage,
    localMasterKey:
      options.localMasterKey === undefined
        ? undefined
        : () => {
            try {
              return options.localMasterKey?.() ?? null;
            } catch {
              return null;
            }
          },
    sources: options.sources,
    sessionId: options.sessionId,
    progress: options.progress,
    beforeActivate: options.beforeActivate,
    activationOperations: activationOperationsForHarness(options.harnessEnv('OVERLOOK_RESTORE_FAULT')),
    workStarted: () => options.workChanged(1),
    workFinished: () => options.workChanged(-1),
    activated: () => {
      if (options.harnessEnv('OVERLOOK_RESTORE_NO_RELAUNCH') === '1') return;
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 250);
    },
  });
}
