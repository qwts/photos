import type { SafeStorageLike } from '../crypto/keystore.js';
import { InteropPairingBundleStore, InteropPairingCustodian } from './pairing-custody.js';
import { InteropPCloudRuntime } from './pcloud-runtime.js';

export interface InteropRuntimeOptions {
  readonly profileDirectory: string;
  readonly safeStorage: SafeStorageLike;
  readonly openExternal: (url: string) => Promise<void>;
}

/** Profile-scoped interoperability authority. Library runtimes borrow its
 * custody but cannot replace provider credentials or retain pairing keys. */
export class InteropRuntime {
  readonly pairing: InteropPairingCustodian;
  readonly pcloud: InteropPCloudRuntime;
  #workCount = 0;

  constructor(options: InteropRuntimeOptions) {
    this.pairing = new InteropPairingCustodian(new InteropPairingBundleStore(options.profileDirectory));
    this.pcloud = new InteropPCloudRuntime({
      ...options,
      pairing: this.pairing,
      isWorkActive: () => this.#workCount > 0,
    });
  }

  busy(): boolean {
    return this.#workCount > 0 || this.pcloud.busy();
  }

  workChanged(delta: 1 | -1): void {
    const next = this.#workCount + delta;
    if (next < 0) throw new Error('Interoperability work counter underflow.');
    this.#workCount = next;
  }

  lock(): void {
    this.pairing.lock();
  }
}

let profileRuntime: InteropRuntime | undefined;

export function configureInteropRuntime(
  profileDirectory: string,
  safeStorage: SafeStorageLike,
  openExternal: (url: string) => Promise<void>,
): InteropRuntime {
  profileRuntime ??= new InteropRuntime({ profileDirectory, safeStorage, openExternal });
  return profileRuntime;
}

export function getInteropRuntime(): InteropRuntime {
  if (profileRuntime === undefined) throw new Error('Interoperability runtime is not configured.');
  return profileRuntime;
}

export function interopRuntimeBusy(): boolean {
  return profileRuntime?.busy() === true;
}

export function lockInteropRuntime(): void {
  profileRuntime?.lock();
}
