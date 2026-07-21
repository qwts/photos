import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { interopPairingBundleSchema, type InteropPairingBundle } from '../../shared/interop/pairing-contract.js';
import { interopPairingStateSchema, type InteropPairingState } from '../../shared/interop/runtime-state.js';
import { openInteropPairingBundle } from './pairing.js';

const PAIRING_DIRECTORY = 'interop';
const PAIRING_FILE = 'pairing-bundle.json';
const MAX_PASSWORD_BYTES = 1024;

export class InteropPairingCustodyError extends Error {
  override readonly name = 'InteropPairingCustodyError';
}

export class InteropPairingBundleStore {
  readonly #directory: string;
  readonly #path: string;

  constructor(profileDirectory: string) {
    this.#directory = join(profileDirectory, PAIRING_DIRECTORY);
    this.#path = join(this.#directory, PAIRING_FILE);
  }

  load(): InteropPairingBundle | null {
    if (!existsSync(this.#path)) return null;
    try {
      return interopPairingBundleSchema.parse(JSON.parse(readFileSync(this.#path, 'utf8')) as unknown);
    } catch {
      throw new InteropPairingCustodyError('Stored interoperability pairing is invalid. Replace the pairing bundle.');
    }
  }

  replace(bundleInput: unknown): InteropPairingBundle {
    const parsed = interopPairingBundleSchema.safeParse(bundleInput);
    if (!parsed.success) throw new InteropPairingCustodyError('Selected interoperability pairing bundle is invalid.');
    const bundle = parsed.data;
    mkdirSync(this.#directory, { recursive: true });
    const staged = `${this.#path}.tmp`;
    writeFileSync(staged, `${JSON.stringify(bundle)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(staged, this.#path);
    return bundle;
  }
}

export interface InteropKeyCustody {
  readonly pairingId: string;
  readonly keyId: string;
  readonly interopKey: Buffer;
}

export class InteropPairingCustodian {
  #opened: InteropKeyCustody | null = null;

  constructor(private readonly store: InteropPairingBundleStore) {}

  state(): InteropPairingState {
    const bundle = this.store.load();
    return interopPairingStateSchema.parse({
      status: bundle === null ? 'not-configured' : this.#opened === null ? 'locked' : 'unlocked',
      pairingId: bundle?.pairingId ?? null,
      keyId: bundle?.keyId ?? null,
      createdAt: bundle?.createdAt ?? null,
    });
  }

  replace(bundleInput: unknown): InteropPairingState {
    this.lock();
    this.store.replace(bundleInput);
    return this.state();
  }

  async unlock(passwordBytes: Uint8Array): Promise<InteropPairingState> {
    if (passwordBytes.byteLength === 0 || passwordBytes.byteLength > MAX_PASSWORD_BYTES) {
      passwordBytes.fill(0);
      throw new InteropPairingCustodyError('Pairing password input is invalid.');
    }
    const bundle = this.store.load();
    if (bundle === null) {
      passwordBytes.fill(0);
      throw new InteropPairingCustodyError('Select a pairing bundle before unlocking interoperability.');
    }
    let opened: Awaited<ReturnType<typeof openInteropPairingBundle>> | null = null;
    try {
      const password = new TextDecoder('utf-8', { fatal: true }).decode(passwordBytes);
      opened = await openInteropPairingBundle(bundle, password);
      this.lock();
      this.#opened = {
        pairingId: opened.pairingId,
        keyId: opened.keyId,
        interopKey: Buffer.from(opened.interopKey),
      };
      return this.state();
    } catch (error) {
      if (error instanceof InteropPairingCustodyError) throw error;
      throw new InteropPairingCustodyError('Unable to unlock the interoperability pairing.');
    } finally {
      passwordBytes.fill(0);
      opened?.interopKey.fill(0);
    }
  }

  withUnlocked<T>(operation: (custody: InteropKeyCustody) => T): T {
    if (this.#opened === null) throw new InteropPairingCustodyError('Interoperability pairing is locked.');
    return operation(this.#opened);
  }

  lock(): void {
    this.#opened?.interopKey.fill(0);
    this.#opened = null;
  }
}
