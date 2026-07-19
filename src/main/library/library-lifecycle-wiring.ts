import { existsSync } from 'node:fs';
import path from 'node:path';

import { BrowserWindow, app } from 'electron';

import { createSwitchLibrary } from './switch-runtime.js';
import type { AppLockHost } from '../crypto/app-lock-host.js';
import { LibraryRegistryError } from './library-registry.js';
import { RelocationError, recoverRelocations, type RelocationDeps } from './relocation-engine.js';
import { RelocationJournalStore } from './relocation-journal.js';
import { RelocationRuntime } from './relocation-runtime.js';
import type { LibraryRegistryRuntime } from './library-registry-runtime.js';
import { KeyStore, type SafeStorageLike } from '../crypto/keystore.js';
import { openLibraryDatabase } from '../db/database.js';
import { createEmitter } from '../../shared/ipc/registry.js';
import { events } from '../../shared/ipc/channels.js';

// Switch + relocation wiring (#385/#483), extracted from the composition root
// (index.ts sits at the 800-line budget). Both runtimes share the same
// closures — teardown, rebind, app-lock swap, renderer reload — so one deps
// bag builds both, and the relocation runtime's reactivate is composed from
// the switch's own tail sequence (ADR-0017 §4 / ADR-0022 §4).

export interface LibraryLifecycleDeps {
  readonly registryRuntime: LibraryRegistryRuntime;
  readonly instanceId: string;
  readonly safeStorage: () => SafeStorageLike;
  readonly activeId: () => string;
  readonly openLibraryId: () => string | null;
  readonly lockState: () => string | undefined;
  readonly providerBusy: () => boolean;
  /** Switch-mode ADR-0017 §4 teardown. */
  readonly closeLibrary: () => Promise<void>;
  /** Rebind settings to wherever the registry points. */
  readonly activateSettings: () => void;
  readonly resetProviderBinding: () => void;
  /** The live host (undefined before the controller exists) + a fresh
   * dataDir-bound controller for the swap after a re-point. */
  readonly appLockHost: () => AppLockHost | undefined;
  readonly buildAppLockController: () => Parameters<AppLockHost['swap']>[0];
  readonly reloadWindows: () => Promise<void>;
  /** OVERLOOK_SWITCH_FAULT harness hook (crash-mid-switch E2E). */
  readonly fault: () => string | undefined;
}

export interface LibraryLifecycle {
  readonly switchLibrary: ReturnType<typeof createSwitchLibrary>;
  readonly getRelocationRuntime: () => RelocationRuntime;
  /** Settles relocation journals (ADR-0022 §2) — must run before anything
   * resolves or opens a library, because recovery may re-point the registry.
   * A corrupt registry is swallowed here: resolveFailure() reports it loud
   * immediately after. */
  readonly settleRelocationJournals: () => Promise<void>;
}

export function createLibraryLifecycle(deps: LibraryLifecycleDeps): LibraryLifecycle {
  const activateLibrary = (): void => {
    deps.activateSettings();
    deps.resetProviderBinding();
  };
  const swapAppLock = async (): Promise<void> => {
    const host = deps.appLockHost();
    if (host !== undefined) await host.swap(deps.buildAppLockController());
  };
  const switchLibrary = createSwitchLibrary({
    registry: deps.registryRuntime,
    activeId: deps.activeId,
    openLibraryId: deps.openLibraryId,
    lockState: deps.lockState,
    providerBusy: deps.providerBusy,
    probeTarget: (id) => deps.registryRuntime.probeSwitchTarget(id),
    closeLibrary: deps.closeLibrary,
    activateLibrary,
    swapAppLock,
    reloadWindows: deps.reloadWindows,
    fault: deps.fault,
    exit: (code) => app.exit(code),
  });

  // Staged-DB health check (ADR-0022 §4 step 3): the staged library must open
  // with its EXISTING custody. Missing custody files are a failed copy —
  // KeyStore.open would mint fresh keys into them, so refuse first.
  const verifyOpenable = (dir: string): Promise<void> => {
    for (const rel of ['master.key', 'keys.json', 'library.db']) {
      if (!existsSync(path.join(dir, rel))) {
        return Promise.reject(new RelocationError('verification-failed', `staged library is missing ${rel}`));
      }
    }
    try {
      const keyStore = KeyStore.open({ safeStorage: deps.safeStorage(), dataDir: dir });
      try {
        const dbKey = keyStore.resolver()(1);
        if (dbKey === undefined) throw new RelocationError('verification-failed', 'staged key store has no KEY #1');
        const db = openLibraryDatabase({ path: path.join(dir, 'library.db'), dbKey });
        db.close();
      } finally {
        keyStore.close();
      }
    } catch (error) {
      return Promise.reject(
        error instanceof RelocationError
          ? error
          : new RelocationError(
              'verification-failed',
              `staged library failed to open with existing custody: ${error instanceof Error ? error.message : String(error)}`,
            ),
      );
    }
    return Promise.resolve();
  };

  // Journals live in the profile root so recovery still runs when the
  // destination volume is unplugged (ADR-0022 §2).
  const engineDeps = (): RelocationDeps => ({
    journals: new RelocationJournalStore(path.join(app.getPath('userData'), 'relocations')),
    registry: deps.registryRuntime.getRegistry(),
    instanceId: deps.instanceId,
    verifyOpenable,
  });

  const emitProgress = createEmitter(events.relocationProgress, (name, payload) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(name, payload);
  });

  let runtime: RelocationRuntime | undefined;
  const getRelocationRuntime = (): RelocationRuntime => {
    runtime ??= new RelocationRuntime({
      engineDeps: engineDeps(),
      active: {
        openLibraryId: deps.openLibraryId,
        lockState: deps.lockState,
        providerBusy: deps.providerBusy,
        closeLibrary: deps.closeLibrary,
        // The switch's own tail: re-point → rebind → swap app lock → reload.
        // The registry decides where the reopen lands (destination after a
        // commit, the untouched source after any refusal or failure).
        reactivate: async (id) => {
          deps.registryRuntime.select(id, null);
          activateLibrary();
          await swapAppLock();
          await deps.reloadWindows();
        },
      },
      emitProgress,
    });
    return runtime;
  };

  const settleRelocationJournals = async (): Promise<void> => {
    try {
      for (const report of await recoverRelocations(engineDeps())) {
        if (report.action !== 'cleanup-finished' && report.action !== 'discarded' && report.action !== 'commit-completed') {
          console.error('[overlook] relocation recovery', report.libraryId, report.action, report.detail ?? '');
        }
      }
    } catch (error) {
      if (!(error instanceof LibraryRegistryError)) throw error;
    }
  };

  return { switchLibrary, getRelocationRuntime, settleRelocationJournals };
}
