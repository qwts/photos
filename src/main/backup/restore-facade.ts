import type { AppAuthorizationResult, AppLockState } from '../crypto/app-lock-controller.js';
import type { RestoreError } from './restore-types.js';
import type { RestoreCoordinator } from './restore-coordinator.js';

export interface RestoreFacadeOptions {
  readonly coordinator: () => RestoreCoordinator;
  readonly fresh: () => boolean;
  readonly pickKey: () => Promise<string | null>;
  readonly busy: () => boolean;
  readonly lockState: () => AppLockState;
  readonly authorizePassword: (password: string) => Promise<AppAuthorizationResult>;
}

type DiscoverKey = { keyPath: string; password: string } | { localKey: true; password?: string | undefined };

type GateError = { reason: RestoreError['reason']; message: string };

/** #754: releasing the keystore-resident master key to restore discovery is
 * destructive-class authority (it can replace the active library). When an
 * app lock is configured, demand the app password at use time — the same
 * fresh-authority ceremony as protected-Original deletion (ADR-0023). The
 * renderer's password field is convenience; this gate is the contract. */
async function authorizeLocalKey(options: RestoreFacadeOptions, password: string | undefined): Promise<GateError | null> {
  const state = options.lockState();
  if (state === 'unconfigured-unlocked') return null;
  if (state !== 'unlocked') {
    return { reason: 'destructive-authorization', message: "Unlock the app before restoring with this Mac's key." };
  }
  if (password === undefined || password === '') {
    return { reason: 'destructive-authorization', message: "Enter your app password to restore with this Mac's key." };
  }
  const result = await options.authorizePassword(password);
  if (result.ok) return null;
  if (result.reason === 'throttled') {
    const seconds = Math.max(1, Math.ceil((result.retryAfterMs ?? 0) / 1000));
    return { reason: 'destructive-authorization', message: `Too many password attempts. Try again in ${String(seconds)}s.` };
  }
  if (result.reason === 'wrong-password') {
    return { reason: 'destructive-authorization', message: 'That app password is incorrect.' };
  }
  return { reason: 'destructive-authorization', message: 'App lock recovery is required before this key can be used.' };
}

export function createRestoreFacade(options: RestoreFacadeOptions) {
  return {
    profileStatus: () => ({ fresh: options.fresh() }),
    pickKey: options.pickKey,
    discover: async (providerId: string, key: DiscoverKey) => {
      if ('keyPath' in key) {
        return options.coordinator().discoverFrom(providerId, { kind: 'recovery-key', path: key.keyPath, password: key.password });
      }
      const refused = await authorizeLocalKey(options, key.password);
      if (refused !== null) return { sessionId: null, libraries: [], error: refused };
      // The password reaches the coordinator only after authorizePassword
      // verified it; the engine reuses it to re-establish password-derived
      // custody for the restored library (#754's second half).
      const custody = options.lockState() === 'unlocked' && key.password !== undefined ? { custodyPassword: key.password } : {};
      return options.coordinator().discoverFrom(providerId, { kind: 'local-master', ...custody });
    },
    run: (sessionId: string, libraryId: string, allowReplace: boolean) => {
      if (options.busy()) {
        return Promise.resolve({
          result: null,
          error: { reason: 'io' as const, message: 'Wait for the active backup or restore to finish.' },
        });
      }
      return options.coordinator().run(sessionId, libraryId, allowReplace);
    },
    cancel: () => {
      options.coordinator().cancel();
    },
  };
}
