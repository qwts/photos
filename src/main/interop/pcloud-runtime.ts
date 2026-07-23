import { join } from 'node:path';

import type { SafeStorageLike } from '../crypto/keystore.js';
import { createPCloudConnect, type PCloudConnectResult } from '../backup/pcloud/connect.js';
import { PCloudTokenStore } from '../backup/pcloud/token-store.js';
import { interopProviderStateSchema, type InteropProviderState } from '../../shared/interop/runtime-state.js';
import { createPCloudInteropStore, type InteropObjectStore } from './transport.js';
import type { InteropPairingCustodian } from './pairing-custody.js';

export interface InteropPCloudRuntimeOptions {
  readonly profileDirectory: string;
  readonly safeStorage: SafeStorageLike;
  readonly openExternal: (url: string) => Promise<void>;
  readonly clientId: string;
  readonly pairing: InteropPairingCustodian;
  readonly isWorkActive?: (() => boolean) | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly connectFlow?: ((tokenStore: PCloudTokenStore) => Promise<PCloudConnectResult>) | undefined;
  readonly objectStore?: InteropObjectStore | undefined;
}

export class InteropPCloudRuntime {
  readonly #tokenStore: PCloudTokenStore;
  readonly #objectStore: InteropObjectStore;
  readonly #connect: () => Promise<PCloudConnectResult>;
  #connecting = false;

  constructor(private readonly options: InteropPCloudRuntimeOptions) {
    this.#tokenStore = new PCloudTokenStore({
      safeStorage: options.safeStorage,
      dataDir: join(options.profileDirectory, 'interop', 'provider-auth', 'pcloud'),
    });
    this.#objectStore =
      options.objectStore ??
      createPCloudInteropStore({
        auth: () => this.#tokenStore.load(),
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      });
    const connectFlow = options.connectFlow;
    this.#connect =
      connectFlow === undefined
        ? createPCloudConnect({
            tokenStore: this.#tokenStore,
            clientId: options.clientId,
            openExternal: options.openExternal,
            onConnected: () => undefined,
          })
        : () => connectFlow(this.#tokenStore);
  }

  objectStore(): InteropObjectStore {
    return this.#objectStore;
  }

  busy(): boolean {
    return this.#connecting || this.options.isWorkActive?.() === true;
  }

  async state(): Promise<InteropProviderState> {
    return interopProviderStateSchema.parse({
      provider: 'pcloud',
      status: await this.#objectStore.authState(),
      busy: this.busy(),
    });
  }

  async connect(): Promise<PCloudConnectResult> {
    if (this.busy()) {
      return { ok: false, reason: 'Wait for the active interoperability operation to finish.' };
    }
    this.#connecting = true;
    try {
      return await this.#connect();
    } finally {
      this.#connecting = false;
    }
  }

  disconnect(): PCloudConnectResult {
    if (this.busy()) {
      return { ok: false, reason: 'Wait for the active interoperability operation to finish.' };
    }
    this.options.pairing.lock();
    try {
      this.#tokenStore.clear();
      if (this.#tokenStore.load() !== null) throw new Error('pCloud interoperability token remained present.');
      return { ok: true, reason: null };
    } catch {
      return { ok: false, reason: 'Could not remove the interoperability pCloud authorization from this device.' };
    }
  }
}
