import { join } from 'node:path';

import type { SafeStorageLike } from '../crypto/keystore.js';
import { readOrMintLibraryId } from '../library/library-id.js';
import { bundledGoogleDriveClientId, bundledGoogleDriveClientSecret } from '../build-config.js';
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
import { ICloudDriveProvider } from './icloud-drive/icloud-drive-provider.js';
import type { ICloudDriveNativeBridge, ICloudDriveUnavailableReason } from './icloud-drive/native-bridge.js';

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
  readonly googleDriveClientSecret?: (() => string | null) | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly iCloudDriveBridge: ICloudDriveNativeBridge;
}

export class ProviderRuntime {
  private readonly options: ProviderRuntimeOptions;
  private tokenStoreInstance: PCloudTokenStore | undefined;
  private connectFlow: (() => Promise<PCloudConnectResult>) | undefined;
  private googleTokenStoreInstance: GoogleDriveTokenStore | undefined;
  private googlePathStoreInstance: GoogleDrivePathStore | undefined;
  private googleAuthInstance: GoogleDriveAuthClient | undefined;
  private googleConnectFlow: (() => Promise<PCloudConnectResult>) | undefined;
  private googleProviderInstance: GoogleDriveProvider | undefined;
  private iCloudDriveProviderInstance: ICloudDriveProvider | undefined;
  private iCloudDriveAvailable = false;
  private registryInstance: ProviderRegistry | undefined;
  private readonly disconnectInFlight = new Map<string, Promise<PCloudConnectResult>>();

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
      clientSecret: () => this.googleClientSecret(),
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
    const value = (this.options.googleDriveClientId?.() ?? bundledGoogleDriveClientId())?.trim() ?? '';
    return value.endsWith('.apps.googleusercontent.com') ? value : null;
  }

  private googleClientSecret(): string | null {
    const value = (this.options.googleDriveClientSecret?.() ?? bundledGoogleDriveClientSecret())?.trim() ?? '';
    return value === '' ? null : value;
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
      clientSecret: () => this.googleClientSecret(),
      tokenStore: this.googleTokenStore(),
      authClient: this.googleAuth(),
      openExternal: this.options.openExternal,
      onConnected: () => {
        this.resetGoogleDriveAccountCache();
        this.options.setProviderId('google-drive');
      },
      ...(this.options.fetchImpl === undefined ? {} : { fetchImpl: this.options.fetchImpl }),
    });
    return this.googleConnectFlow();
  }

  async descriptors(): Promise<readonly ProviderDescriptor[]> {
    const iCloudStatus = this.registryInstance?.get('icloud-drive') === undefined ? null : await this.iCloudStatus();
    this.iCloudDriveAvailable = iCloudStatus?.available === true;
    return (this.registryInstance?.list() ?? []).map((provider) => {
      const googleUnavailable = provider.id === 'google-drive' && this.googleClientId() === null;
      const iCloudUnavailable = provider.id === 'icloud-drive' && iCloudStatus?.available !== true;
      return {
        id: provider.id,
        label: provider.label,
        capabilities: provider.capabilities,
        available: !googleUnavailable && !iCloudUnavailable,
        unavailableReason: googleUnavailable
          ? 'Google Drive OAuth is not configured in this build.'
          : iCloudUnavailable
            ? iCloudUnavailableCopy(iCloudStatus?.reason ?? 'native-unavailable')
            : null,
      };
    });
  }

  provider(id: string): StorageProvider | undefined {
    return this.registryInstance?.get(id);
  }

  async restoreSources(providerId: string): Promise<readonly { libraryId: string; provider: StorageProvider }[]> {
    const provider = this.provider(providerId);
    const descriptor = (await this.descriptors()).find((candidate) => candidate.id === providerId);
    if (provider === undefined || descriptor?.available !== true) throw new Error(`provider is not available: ${providerId}`);
    const libraryIds = await provider.listLibraries();
    return libraryIds.map((libraryId) => ({ libraryId, provider: provider.forLibrary(libraryId) }));
  }

  /** Provider instances are remote-home scoped. Credentials intentionally
   * survive a switch, but the registry must be rebuilt for the new library
   * before status or data operations can observe it (#387). */
  resetLibraryBinding(): void {
    this.registryInstance = undefined;
    this.googleProviderInstance = undefined;
    this.iCloudDriveProviderInstance = undefined;
    this.iCloudDriveAvailable = false;
  }

  async status(providerId: string): Promise<{
    provider: ProviderDescriptor;
    connected: boolean;
    account: string | null;
    usedBytes: number | null;
    totalBytes: number | null;
  }> {
    const provider = this.provider(providerId);
    const descriptor = (await this.descriptors()).find((candidate) => candidate.id === providerId);
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
    const descriptor = (await this.descriptors()).find((candidate) => candidate.id === providerId);
    if (provider === undefined || descriptor?.available !== true) {
      return { ok: false, reason: descriptor?.unavailableReason ?? 'This provider is not available on this device.' };
    }
    if (providerId === 'pcloud') {
      return this.connectPCloud();
    }
    if (providerId === 'google-drive') {
      return this.connectGoogleDrive();
    }
    if (providerId === 'icloud-drive' && provider instanceof ICloudDriveProvider) {
      provider.resetAccountAuthority();
      if ((await provider.authState()) !== 'connected') {
        return { ok: false, reason: 'Sign in to iCloud Drive in macOS Settings, then try again.' };
      }
    }
    if (provider instanceof FaultInjectingProvider) {
      provider.disarm('auth-expired');
    }
    this.options.setProviderId(providerId);
    return { ok: true, reason: null };
  }

  disconnect(providerId: string): Promise<PCloudConnectResult> {
    const pending = this.disconnectInFlight.get(providerId);
    if (pending !== undefined) return pending;
    const operation = Promise.resolve()
      .then(() => this.disconnectOnce(providerId))
      .finally(() => {
        if (this.disconnectInFlight.get(providerId) === operation) this.disconnectInFlight.delete(providerId);
      });
    this.disconnectInFlight.set(providerId, operation);
    return operation;
  }

  private disconnectOnce(providerId: string): PCloudConnectResult {
    if (this.options.isWorkActive?.() === true) {
      return { ok: false, reason: 'Wait for the active backup or restore to finish before disconnecting.' };
    }
    if (providerId === 'pcloud') return this.disconnectPCloud();
    try {
      if (providerId === 'google-drive') {
        this.googleAuth().clear();
        this.resetGoogleDriveAccountCache();
      }
      if (providerId === 'icloud-drive') this.iCloudDriveProviderInstance?.resetAccountAuthority();
      if (this.options.providerId() === providerId) this.options.setProviderId(null);
      if (this.options.providerId() === providerId) {
        return { ok: false, reason: 'Could not save the disconnected state. Try again.' };
      }
      return { ok: true, reason: null };
    } catch {
      return { ok: false, reason: 'Could not remove this provider’s authorization from this device. Try again.' };
    }
  }

  private disconnectPCloud(): PCloudConnectResult {
    const store = this.tokenStore();
    const previous = store.load();
    try {
      store.clear();
    } catch {
      return { ok: false, reason: 'Could not remove the pCloud authorization from this device. Check file access and try again.' };
    }
    if (store.load() !== null) {
      return { ok: false, reason: 'Could not verify that the pCloud authorization was removed. Check status and try again.' };
    }

    try {
      if (this.options.providerId() === 'pcloud') this.options.setProviderId(null);
    } catch {
      // Verification below decides whether the write completed before the
      // exception. Never roll a completed disconnect back on an emit failure.
    }
    const selectionCleared = this.options.providerId() !== 'pcloud';
    const custodyCleared = store.load() === null;
    if (selectionCleared && custodyCleared) return { ok: true, reason: null };
    if (!selectionCleared) return this.rollbackPCloudCustody(previous);
    return {
      ok: false,
      reason: 'Disconnect could not be verified because pCloud authorization changed during the operation. Check status and try again.',
    };
  }

  private rollbackPCloudCustody(previous: ReturnType<PCloudTokenStore['load']>): PCloudConnectResult {
    if (previous !== null) {
      try {
        this.tokenStore().save(previous);
      } catch {
        return {
          ok: false,
          reason: 'Disconnect could not be completed or rolled back. Restart Overlook, check pCloud status, and try again.',
        };
      }
    }
    return { ok: false, reason: 'Could not save the disconnected state. pCloud remains connected; try again.' };
  }

  /** The library's remote identity (ADR-0007) — the same ULID as the local
   * library identity (ADR-0017 §2), read from <dataDir>/library-id. Since
   * #384 the registry mints it eagerly; the mint fallback here covers
   * pre-registry directories opened directly. */
  libraryId(): string {
    return readOrMintLibraryId(this.options.dataDir());
  }

  /** Who Connect targets while disconnected: packaged builds are
   * pCloud-only; dev/e2e default to the mock, overridable via the
   * harness-gated OVERLOOK_PROVIDER. */
  defaultTarget(): string {
    const override = this.options.harnessEnv('OVERLOOK_PROVIDER');
    if (
      override === 'mock' ||
      override === 'pcloud' ||
      override === 'icloud-drive' ||
      (override === 'google-drive' && this.googleClientId() !== null)
    ) {
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
    if (raw === 'icloud-drive' && !this.iCloudDriveAvailable) {
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
    const googleProvider = new GoogleDriveProvider({
      auth: this.googleAuth(),
      paths: this.googlePathStore(),
      libraryId,
      ...(this.options.fetchImpl === undefined ? {} : { fetchImpl: this.options.fetchImpl }),
    });
    this.googleProviderInstance = googleProvider;
    registry.register(googleProvider);
    const iCloudProvider = new ICloudDriveProvider({ bridge: this.options.iCloudDriveBridge, libraryId });
    this.iCloudDriveProviderInstance = iCloudProvider;
    registry.register(iCloudProvider);
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

  private resetGoogleDriveAccountCache(): void {
    if (this.googleProviderInstance === undefined) {
      this.googlePathStore().clear();
      return;
    }
    this.googleProviderInstance.resetAccountCache();
  }

  private async iCloudStatus() {
    try {
      return await this.options.iCloudDriveBridge.status();
    } catch {
      return { available: false as const, reason: 'native-unavailable' as const, accountToken: null };
    }
  }
}

function iCloudUnavailableCopy(reason: ICloudDriveUnavailableReason): string {
  const copy: Record<ICloudDriveUnavailableReason, string> = {
    'unsupported-platform': 'iCloud Drive is available only on macOS.',
    'unsigned-build': 'iCloud Drive requires a provisioned signed macOS build.',
    'native-unavailable': 'iCloud Drive support is unavailable in this build.',
    unentitled: 'This build is not entitled for iCloud Drive.',
    'account-unavailable': 'Sign in to iCloud Drive in macOS Settings.',
  };
  return copy[reason];
}
