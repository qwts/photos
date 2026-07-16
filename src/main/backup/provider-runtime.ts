import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SafeStorageLike } from '../crypto/keystore.js';
import { ulid } from '../import/ulid.js';
import { createActiveProvider } from './active-provider.js';
import { GoogleDriveAuthClient } from './google-drive/auth-client.js';
import { createGoogleDriveConnect } from './google-drive/connect.js';
import { GoogleDriveProvider } from './google-drive/google-drive-provider.js';
import { GoogleDrivePathStore } from './google-drive/path-store.js';
import { GoogleDriveTokenStore } from './google-drive/token-store.js';
import { FaultInjectingProvider, MockProvider, ProviderRegistry } from './mock-provider.js';
import { createPCloudConnect, type PCloudConnectResult } from './pcloud/connect.js';
import { PCloudProvider } from './pcloud/pcloud-provider.js';
import { PCloudTokenStore } from './pcloud/token-store.js';
import type { StorageProvider } from './provider.js';
import type { ProviderDescriptor } from '../../shared/backup/provider-descriptor.js';

// Provider-selection + pCloud-custody runtime (#256), extracted from the
// composition root: which provider is active, who Connect targets, the
// library's remote identity, and the pCloud token/handshake lifecycle. All
// Electron dependencies are injected so node:test covers the policy.

export interface ProviderRuntimeOptions {
  readonly dataDir: () => string;
  /** Profile-level provider credential custody; unlike library data this
   * directory survives atomic library replacement during restore. */
  readonly credentialDir?: (() => string) | undefined;
  /** Preferred multi-provider custody root. Existing callers may keep
   * credentialDir as the pCloud-specific compatibility seam. */
  readonly providerCredentialDir?: ((providerId: string) => string) | undefined;
  readonly safeStorage: () => SafeStorageLike;
  readonly openExternal: (url: string) => Promise<void>;
  readonly setProviderId: (id: string | null) => void;
  readonly providerId: () => string | null;
  readonly isWorkActive?: (() => boolean) | undefined;
  readonly isPackaged: boolean;
  readonly harnessEnv: (name: string) => string | undefined;
  readonly googleDriveClientId?: (() => string | null) | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

export class ProviderRuntime {
  private readonly options: ProviderRuntimeOptions;
  private tokenStoreInstance: PCloudTokenStore | undefined;
  private connectFlow: (() => Promise<PCloudConnectResult>) | undefined;
  private googleTokenStoreInstance: GoogleDriveTokenStore | undefined;
  private googlePathStoreInstance: GoogleDrivePathStore | undefined;
  private googleAuthInstance: GoogleDriveAuthClient | undefined;
  private googleConnectFlow: (() => Promise<PCloudConnectResult>) | undefined;
  private registryInstance: ProviderRegistry | undefined;

  constructor(options: ProviderRuntimeOptions) {
    this.options = options;
  }

  tokenStore(): PCloudTokenStore {
    if (this.tokenStoreInstance === undefined) {
      const safeStorage = this.options.safeStorage();
      const credentialDir = this.credentialDirectory('pcloud');
      this.tokenStoreInstance = new PCloudTokenStore({ safeStorage, dataDir: credentialDir });
      if (credentialDir !== this.options.dataDir() && this.tokenStoreInstance.load() === null) {
        const legacy = new PCloudTokenStore({ safeStorage, dataDir: this.options.dataDir() });
        const record = legacy.load();
        if (record !== null) {
          this.tokenStoreInstance.save(record);
          legacy.clear();
        }
      }
    }
    return this.tokenStoreInstance;
  }

  googleTokenStore(): GoogleDriveTokenStore {
    this.googleTokenStoreInstance ??= new GoogleDriveTokenStore({
      safeStorage: this.options.safeStorage(),
      dataDir: this.credentialDirectory('google-drive'),
    });
    return this.googleTokenStoreInstance;
  }

  private googlePathStore(): GoogleDrivePathStore {
    this.googlePathStoreInstance ??= new GoogleDrivePathStore(this.credentialDirectory('google-drive'));
    return this.googlePathStoreInstance;
  }

  private googleAuth(): GoogleDriveAuthClient {
    this.googleAuthInstance ??= new GoogleDriveAuthClient({
      clientId: () => this.googleClientId(),
      tokenStore: this.googleTokenStore(),
      ...(this.options.fetchImpl === undefined ? {} : { fetchImpl: this.options.fetchImpl }),
    });
    return this.googleAuthInstance;
  }

  private credentialDirectory(providerId: string): string {
    if (this.options.providerCredentialDir !== undefined) return this.options.providerCredentialDir(providerId);
    if (providerId === 'pcloud' && this.options.credentialDir !== undefined) return this.options.credentialDir();
    return join(this.options.dataDir(), `${providerId}-auth`);
  }

  private googleClientId(): string | null {
    const value = this.options.googleDriveClientId?.()?.trim() ?? '';
    return value.endsWith('.apps.googleusercontent.com') ? value : null;
  }

  private connectPCloud(): Promise<PCloudConnectResult> {
    this.connectFlow ??= createPCloudConnect({
      tokenStore: this.tokenStore(),
      openExternal: this.options.openExternal,
      onConnected: () => {
        this.options.setProviderId('pcloud');
      },
    });
    return this.connectFlow();
  }

  private connectGoogleDrive(): Promise<PCloudConnectResult> {
    this.googleConnectFlow ??= createGoogleDriveConnect({
      clientId: () => this.googleClientId(),
      tokenStore: this.googleTokenStore(),
      authClient: this.googleAuth(),
      openExternal: this.options.openExternal,
      onConnected: () => this.options.setProviderId('google-drive'),
      ...(this.options.fetchImpl === undefined ? {} : { fetchImpl: this.options.fetchImpl }),
    });
    return this.googleConnectFlow();
  }

  descriptors(): readonly ProviderDescriptor[] {
    return (this.registryInstance?.list() ?? []).map((provider) => {
      const googleUnavailable = provider.id === 'google-drive' && this.googleClientId() === null;
      return {
        id: provider.id,
        label: provider.label,
        capabilities: provider.capabilities,
        available: !googleUnavailable,
        unavailableReason: googleUnavailable ? 'Google Drive OAuth is not configured in this build.' : null,
      };
    });
  }

  provider(id: string): StorageProvider | undefined {
    return this.registryInstance?.get(id);
  }

  async restoreSources(providerId: string): Promise<readonly { libraryId: string; provider: StorageProvider }[]> {
    const provider = this.provider(providerId);
    const descriptor = this.descriptors().find((candidate) => candidate.id === providerId);
    if (provider === undefined || descriptor?.available !== true) throw new Error(`provider is not available: ${providerId}`);
    const libraryIds = await provider.listLibraries();
    return libraryIds.map((libraryId) => ({ libraryId, provider: provider.forLibrary(libraryId) }));
  }

  async status(providerId: string): Promise<{
    provider: ProviderDescriptor;
    connected: boolean;
    account: string | null;
    usedBytes: number | null;
    totalBytes: number | null;
  }> {
    const provider = this.provider(providerId);
    const descriptor = this.descriptors().find((candidate) => candidate.id === providerId);
    if (provider === undefined || descriptor === undefined) {
      throw new Error(`provider is not available: ${providerId}`);
    }
    const connected = this.activeId() === providerId && (await provider.authState()) === 'connected';
    if (!connected || provider.capabilities.quota === 'unknown') {
      return { provider: descriptor, connected, account: null, usedBytes: null, totalBytes: null };
    }
    try {
      const quota = await provider.quota();
      return { provider: descriptor, connected: true, account: null, usedBytes: quota.usedBytes, totalBytes: quota.totalBytes };
    } catch {
      return { provider: descriptor, connected: false, account: null, usedBytes: null, totalBytes: null };
    }
  }

  async connect(providerId: string): Promise<PCloudConnectResult> {
    if (this.options.isWorkActive?.() === true) {
      return { ok: false, reason: 'Wait for the active backup or restore to finish before switching providers.' };
    }
    const provider = this.provider(providerId);
    const descriptor = this.descriptors().find((candidate) => candidate.id === providerId);
    if (provider === undefined || descriptor?.available !== true) {
      return { ok: false, reason: 'This provider is not available on this device.' };
    }
    if (providerId === 'pcloud') {
      return this.connectPCloud();
    }
    if (providerId === 'google-drive') {
      return this.connectGoogleDrive();
    }
    if (provider instanceof FaultInjectingProvider) {
      provider.disarm('auth-expired');
    }
    this.options.setProviderId(providerId);
    return { ok: true, reason: null };
  }

  disconnect(providerId: string): PCloudConnectResult {
    if (this.options.isWorkActive?.() === true) {
      return { ok: false, reason: 'Wait for the active backup or restore to finish before disconnecting.' };
    }
    if (providerId === 'pcloud') {
      this.tokenStore().clear();
    }
    if (providerId === 'google-drive') {
      this.googleAuth().clear();
    }
    if (this.activeId() === providerId) {
      this.options.setProviderId(null);
    }
    return { ok: true, reason: null };
  }

  /** The library's remote identity (ADR-0007): a ULID minted lazily on
   * first need and persisted next to the library — restores keep uploading
   * into the same /Overlook/<id>/ home. */
  libraryId(): string {
    const idPath = join(this.options.dataDir(), 'library-id');
    if (existsSync(idPath)) {
      const stored = readFileSync(idPath, 'utf8').trim();
      // Only a well-formed ULID names a remote home (PR #260 review): a
      // truncated/corrupted record would poison every future remote path
      // (even ''), so it is replaced — it never named a valid home.
      if (/^[0-9A-HJKMNP-TV-Z]{26}$/u.test(stored)) {
        return stored;
      }
    }
    const id = ulid();
    mkdirSync(this.options.dataDir(), { recursive: true });
    // Atomic like every other library record — a crash mid-write must not
    // leave a half-written id behind.
    writeFileSync(`${idPath}.tmp`, id);
    renameSync(`${idPath}.tmp`, idPath);
    return id;
  }

  /** Who Connect targets while disconnected: packaged builds are
   * pCloud-only; dev/e2e default to the mock, overridable via the
   * harness-gated OVERLOOK_PROVIDER. */
  defaultTarget(): string {
    const override = this.options.harnessEnv('OVERLOOK_PROVIDER');
    if (override === 'mock' || override === 'pcloud' || (override === 'google-drive' && this.googleClientId() !== null)) {
      return override;
    }
    return this.options.isPackaged ? 'pcloud' : 'mock';
  }

  /** settings.providerId with the packaged-build correction: 'mock' is not
   * a real provider there (never registered), so a stale/default 'mock'
   * value reads as disconnected instead of silently "backing up" to a local
   * folder. */
  activeId(): string | null {
    const raw = this.options.providerId();
    if (raw === null) {
      return null;
    }
    if (raw === 'mock' && this.options.isPackaged) {
      return null;
    }
    if (raw === 'google-drive' && this.googleClientId() === null) {
      return null;
    }
    if (this.registryInstance !== undefined && this.registryInstance.get(raw) === undefined) {
      return null;
    }
    return raw;
  }

  /** The engine-facing provider: pCloud always registered; the mock only
   * outside packaged builds (dev + e2e, where it stays the default Connect
   * target so every harness flow is unchanged), optionally fault-armed via
   * the #110 harness hook. */
  buildProvider(build: { mockRootDir: string; fault: string | undefined; libraryId?: string | undefined }): StorageProvider {
    const registry = new ProviderRegistry();
    const libraryId = build.libraryId ?? this.libraryId();
    registry.register(new PCloudProvider({ auth: () => this.tokenStore().load(), libraryId }));
    registry.register(
      new GoogleDriveProvider({
        auth: this.googleAuth(),
        paths: this.googlePathStore(),
        libraryId,
        ...(this.options.fetchImpl === undefined ? {} : { fetchImpl: this.options.fetchImpl }),
      }),
    );
    if (!this.options.isPackaged) {
      const faulty = new FaultInjectingProvider(new MockProvider({ rootDir: build.mockRootDir, libraryId }));
      const fault = build.fault;
      if (fault === 'put' || fault === 'verify-mismatch' || fault === 'auth-expired' || fault === 'transient-get') {
        faulty.arm(fault);
      }
      registry.register(faulty);
    }
    this.registryInstance = registry;
    return createActiveProvider({ registry, activeId: () => this.activeId(), defaultId: () => this.defaultTarget() });
  }
}
