import type { ProviderRuntime } from './provider-runtime.js';

export interface BackupFacadeOptions {
  readonly runtime: () => ProviderRuntime;
  readonly run: () => Promise<{ uploaded: number; failed: number; skipped: 'wifi' | null }>;
  readonly offload: (photoIds: readonly string[]) => Promise<{ offloaded: number; skipped: number; freedBytes: number }>;
  readonly rehydrate: (photoId: string) => Promise<void>;
}

export function createBackupFacade(options: BackupFacadeOptions) {
  return {
    run: () => {
      if (options.runtime().activeId() === null) {
        return Promise.resolve({ uploaded: 0, failed: 0, skipped: 'disconnected' as const });
      }
      return options.run();
    },
    offload: options.offload,
    rehydrate: options.rehydrate,
    providers: () => ({ providers: options.runtime().descriptors(), defaultProviderId: options.runtime().defaultTarget() }),
    providerStatus: (providerId: string) => options.runtime().status(providerId),
    connect: (providerId: string) => options.runtime().connect(providerId),
    disconnect: (providerId: string) => Promise.resolve(options.runtime().disconnect(providerId)),
  };
}
