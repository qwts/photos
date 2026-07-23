import type { RestoreCoordinator } from './restore-coordinator.js';

export interface RestoreFacadeOptions {
  readonly coordinator: () => RestoreCoordinator;
  readonly fresh: () => boolean;
  readonly pickKey: () => Promise<string | null>;
  readonly busy: () => boolean;
}

export function createRestoreFacade(options: RestoreFacadeOptions) {
  return {
    profileStatus: () => ({ fresh: options.fresh() }),
    pickKey: options.pickKey,
    discover: (providerId: string, key: { keyPath: string; password: string } | 'local-master') =>
      options
        .coordinator()
        .discoverFrom(
          providerId,
          key === 'local-master' ? { kind: 'local-master' } : { kind: 'recovery-key', path: key.keyPath, password: key.password },
        ),
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
