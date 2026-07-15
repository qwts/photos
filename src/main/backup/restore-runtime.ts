import { ThumbnailPool } from '../import/thumbnail-pool.js';
import { ThumbnailService } from '../import/thumbnail-service.js';
import type { SafeStorageLike } from '../crypto/keystore.js';
import { readRecoveryKeyFile } from '../crypto/recovery-key-facade.js';
import type { StorageProvider } from './provider.js';
import { RestoreCoordinator, type RestoreSource } from './restore-coordinator.js';
import { RestoreEngine, type RestoreRunResult } from './restore-engine.js';
import { loadCheckpoint, restorePaths } from './restore-staging.js';
import type { RestoreProgress } from './restore-types.js';

export interface RestoreRuntimeOptions {
  readonly targetDir: string;
  readonly workerUrl: URL;
  readonly safeStorage: () => SafeStorageLike;
  readonly sources: (providerId: string) => Promise<readonly RestoreSource[]>;
  readonly sessionId: () => string;
  readonly progress: (value: RestoreProgress) => void;
  readonly beforeActivate: () => Promise<void>;
  readonly workStarted: () => void;
  readonly workFinished: () => void;
  readonly activated: (result: RestoreRunResult) => void;
}

export class RestoreRuntime {
  readonly coordinator: RestoreCoordinator;

  constructor(options: RestoreRuntimeOptions) {
    this.coordinator = new RestoreCoordinator({
      readRecoveryKey: readRecoveryKeyFile,
      sources: options.sources,
      createRunner: (provider: StorageProvider, progress) => {
        const pool = new ThumbnailPool({ workerUrl: options.workerUrl });
        const engine = new RestoreEngine({
          provider,
          targetDir: options.targetDir,
          safeStorage: options.safeStorage(),
          thumbnails: (store) => new ThumbnailService(pool, store),
          beforeActivate: options.beforeActivate,
          events: { progress },
        });
        return {
          run: async (request) => {
            try {
              return await engine.run(request);
            } finally {
              await pool.close();
            }
          },
        };
      },
      sessionId: options.sessionId,
      resumeAvailable: async (libraryId, candidate) => {
        const checkpoint = await loadCheckpoint(restorePaths(options.targetDir));
        return (
          checkpoint !== null &&
          checkpoint.libraryId === libraryId &&
          checkpoint.manifestPath === candidate.path &&
          checkpoint.sealedManifestSha256 === candidate.sealedSha256 &&
          (checkpoint.completedBlobIds.length > 0 || checkpoint.completedThumbnailIds.length > 0)
        );
      },
      progress: options.progress,
      workStarted: options.workStarted,
      workFinished: options.workFinished,
      activated: options.activated,
    });
  }

  dispose(): void {
    this.coordinator.dispose();
  }
}
