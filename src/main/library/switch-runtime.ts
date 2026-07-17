import type { LibraryRegistryRuntime } from './library-registry-runtime.js';
import type { LibraryDescriptor } from '../../shared/library/registry.js';

// Live library switch (#385, ADR-0017 §4): guards → stamp selection → full
// teardown → repoint → swap the app-lock controller → reload the renderer.
// The selection is stamped BEFORE teardown on purpose: a crash anywhere
// mid-switch leaves the registry pointing at the target, so the relaunch
// opens it and the interrupted library recovers via WAL + journals on its
// next open (acceptance 3).

export interface SwitchLibraryResult {
  readonly library: LibraryDescriptor;
  readonly requiresRestart: boolean;
}

export interface SwitchLibraryDeps {
  readonly registry: Pick<LibraryRegistryRuntime, 'select'>;
  readonly openLibraryId: () => string | null;
  /** App-lock state, undefined before the controller exists. */
  readonly lockState: () => string | undefined;
  /** True while backup/restore provider work is in flight (ADR-0011 parity). */
  readonly providerBusy: () => boolean;
  /** Switch-mode teardown: everything closeLibraryForLock does except the
   * window reload, which happens after the app-lock swap below. */
  readonly closeLibrary: () => Promise<void>;
  /** Rebuilds the dataDir-bound app-lock controller for the new library. */
  readonly swapAppLock: () => Promise<void>;
  readonly reloadWindows: () => Promise<void>;
  /** OVERLOOK_SWITCH_FAULT harness hook ('after-close' kills the process
   * between teardown and reopen — the crash-mid-switch E2E). */
  readonly fault: () => string | undefined;
  readonly exit: (code: number) => void;
}

export function createSwitchLibrary(deps: SwitchLibraryDeps): (id: string) => Promise<SwitchLibraryResult> {
  let switching = false;
  return async (id) => {
    if (switching) {
      throw new Error('a library switch is already in progress');
    }
    const lockState = deps.lockState();
    if (lockState !== undefined && lockState !== 'unconfigured-unlocked' && lockState !== 'unlocked') {
      throw new Error('cannot switch libraries while the library is locked');
    }
    if (deps.providerBusy()) {
      throw new Error('cannot switch libraries while backup or restore work is active');
    }
    // Validates the target (registered, directory present) and stamps
    // lastOpenedAt — the crash-safety anchor described above.
    const selected = deps.registry.select(id, deps.openLibraryId());
    if (!selected.requiresRestart) {
      // Same library, or nothing open yet — selection alone completes it.
      return { library: selected.library, requiresRestart: false };
    }
    switching = true;
    try {
      await deps.closeLibrary();
      if (deps.fault() === 'after-close') deps.exit(1);
      // Nothing is open now: re-select repoints the runtime's active entry.
      const repointed = deps.registry.select(id, null);
      await deps.swapAppLock();
      await deps.reloadWindows();
      return { library: repointed.library, requiresRestart: false };
    } finally {
      switching = false;
    }
  };
}
