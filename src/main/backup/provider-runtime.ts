import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SafeStorageLike } from '../crypto/keystore.js';
import { ulid } from '../import/ulid.js';
import { createActiveProvider } from './active-provider.js';
import { FaultInjectingProvider, MockProvider, ProviderRegistry } from './mock-provider.js';
import { createPCloudConnect, type PCloudConnectResult } from './pcloud/connect.js';
import { PCloudProvider } from './pcloud/pcloud-provider.js';
import { PCloudTokenStore } from './pcloud/token-store.js';
import type { StorageProvider } from './provider.js';

// Provider-selection + pCloud-custody runtime (#256), extracted from the
// composition root: which provider is active, who Connect targets, the
// library's remote identity, and the pCloud token/handshake lifecycle. All
// Electron dependencies are injected so node:test covers the policy.

export interface ProviderRuntimeOptions {
  readonly dataDir: () => string;
  readonly safeStorage: () => SafeStorageLike;
  readonly openExternal: (url: string) => Promise<void>;
  readonly setProviderId: (id: 'pcloud') => void;
  readonly providerId: () => 'mock' | 'pcloud' | null;
  readonly isPackaged: boolean;
  readonly harnessEnv: (name: string) => string | undefined;
}

export class ProviderRuntime {
  private readonly options: ProviderRuntimeOptions;
  private tokenStoreInstance: PCloudTokenStore | undefined;
  private connectFlow: (() => Promise<PCloudConnectResult>) | undefined;

  constructor(options: ProviderRuntimeOptions) {
    this.options = options;
  }

  tokenStore(): PCloudTokenStore {
    this.tokenStoreInstance ??= new PCloudTokenStore({ safeStorage: this.options.safeStorage(), dataDir: this.options.dataDir() });
    return this.tokenStoreInstance;
  }

  connect(): Promise<PCloudConnectResult> {
    this.connectFlow ??= createPCloudConnect({
      tokenStore: this.tokenStore(),
      openExternal: this.options.openExternal,
      onConnected: () => {
        this.options.setProviderId('pcloud');
      },
    });
    return this.connectFlow();
  }

  /** The library's remote identity (ADR-0007): a ULID minted lazily on
   * first need and persisted next to the library — restores keep uploading
   * into the same /Overlook/<id>/ home. */
  libraryId(): string {
    const idPath = join(this.options.dataDir(), 'library-id');
    if (existsSync(idPath)) {
      return readFileSync(idPath, 'utf8').trim();
    }
    const id = ulid();
    mkdirSync(this.options.dataDir(), { recursive: true });
    writeFileSync(idPath, id);
    return id;
  }

  /** Who Connect targets while disconnected: packaged builds are
   * pCloud-only; dev/e2e default to the mock, overridable via the
   * harness-gated OVERLOOK_PROVIDER. */
  defaultTarget(): 'mock' | 'pcloud' {
    const override = this.options.harnessEnv('OVERLOOK_PROVIDER');
    if (override === 'mock' || override === 'pcloud') {
      return override;
    }
    return this.options.isPackaged ? 'pcloud' : 'mock';
  }

  /** settings.providerId with the packaged-build correction: 'mock' is not
   * a real provider there (never registered), so a stale/default 'mock'
   * value reads as disconnected instead of silently "backing up" to a local
   * folder. */
  activeId(): 'mock' | 'pcloud' | null {
    const raw = this.options.providerId();
    if (raw === 'mock' && this.options.isPackaged) {
      return null;
    }
    return raw;
  }

  /** The engine-facing provider: pCloud always registered; the mock only
   * outside packaged builds (dev + e2e, where it stays the default Connect
   * target so every harness flow is unchanged), optionally fault-armed via
   * the #110 harness hook. */
  buildProvider(build: { mockRootDir: string; fault: string | undefined }): StorageProvider {
    const registry = new ProviderRegistry();
    registry.register(new PCloudProvider({ auth: () => this.tokenStore().load(), libraryId: this.libraryId() }));
    if (!this.options.isPackaged) {
      const faulty = new FaultInjectingProvider(new MockProvider({ rootDir: build.mockRootDir }));
      const fault = build.fault;
      if (fault === 'put' || fault === 'verify-mismatch' || fault === 'auth-expired' || fault === 'transient-get') {
        faulty.arm(fault);
      }
      registry.register(faulty);
    }
    return createActiveProvider({ registry, activeId: () => this.activeId(), defaultId: () => this.defaultTarget() });
  }
}
