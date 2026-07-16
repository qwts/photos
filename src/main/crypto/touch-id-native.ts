import { createRequire } from 'node:module';

import {
  TouchIdAdapterError,
  type TouchIdAdapterErrorCode,
  type TouchIdAvailability,
  type TouchIdSecureAdapter,
  type TouchIdUnavailableReason,
} from './touch-id.js';

const EXPECTED_BUNDLE_ID = 'com.qwts.overlook';
const ACCOUNT_PATTERN = /^v1:[a-f0-9]{64}$/u;
const nativeRequire = createRequire(import.meta.url);

function defaultLoadBinding(): unknown {
  // isNativeBinding validates this CommonJS value before any method is reachable.
  return nativeRequire('@overlook/touch-id');
}

interface NativeBinding {
  availability(expectedBundleId: string): unknown;
  store(expectedBundleId: string, account: string, secret: Buffer): Promise<void>;
  read(expectedBundleId: string, account: string, reason: string): Promise<unknown>;
  clear(expectedBundleId: string, account: string): Promise<void>;
}

export interface NativeTouchIdAdapterOptions {
  readonly platform: NodeJS.Platform;
  readonly packaged: boolean;
  readonly loadBinding?: () => unknown;
}

const unavailableReasons = new Set<TouchIdUnavailableReason>(['unsigned-build', 'not-enrolled', 'locked-out', 'unavailable']);

const adapterErrorCodes = new Set<TouchIdAdapterErrorCode>([
  'cancelled',
  'failed',
  'locked-out',
  'unavailable',
  'missing',
  'storage-failure',
]);

function unavailable(reason: TouchIdUnavailableReason): TouchIdSecureAdapter {
  const reject = (): Promise<never> => Promise.reject(new TouchIdAdapterError('unavailable'));
  return {
    availability: () => ({ available: false, reason }),
    store: reject,
    read: reject,
    clear: reject,
  };
}

function isNativeBinding(value: unknown): value is NativeBinding {
  if (typeof value !== 'object' || value === null) return false;
  const binding = value as Record<string, unknown>;
  return (
    typeof binding['availability'] === 'function' &&
    typeof binding['store'] === 'function' &&
    typeof binding['read'] === 'function' &&
    typeof binding['clear'] === 'function'
  );
}

function normalizeAvailability(value: unknown): TouchIdAvailability {
  if (typeof value !== 'object' || value === null) return { available: false, reason: 'native-unavailable' };
  const result = value as { readonly available?: unknown; readonly reason?: unknown };
  if (result.available === true && result.reason === null) return { available: true, reason: null };
  if (
    result.available === false &&
    typeof result.reason === 'string' &&
    unavailableReasons.has(result.reason as TouchIdUnavailableReason)
  ) {
    return { available: false, reason: result.reason as TouchIdUnavailableReason };
  }
  return { available: false, reason: 'native-unavailable' };
}

function mappedError(error: unknown): TouchIdAdapterError {
  if (error instanceof TouchIdAdapterError) return error;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === 'string' && adapterErrorCodes.has(code as TouchIdAdapterErrorCode)) {
      return new TouchIdAdapterError(code as TouchIdAdapterErrorCode);
    }
  }
  return new TouchIdAdapterError('unavailable');
}

function validAccount(account: string): void {
  if (!ACCOUNT_PATTERN.test(account)) throw new TouchIdAdapterError('storage-failure');
}

/** Loads the optional native bridge only inside packaged macOS builds. The
 * binding independently verifies the running code signature on every call. */
export function createNativeTouchIdAdapter(options: NativeTouchIdAdapterOptions): TouchIdSecureAdapter {
  if (options.platform !== 'darwin') return unavailable('unsupported-platform');
  if (!options.packaged) return unavailable('unsigned-build');
  let binding: NativeBinding;
  try {
    const loaded = (options.loadBinding ?? defaultLoadBinding)();
    if (!isNativeBinding(loaded)) return unavailable('native-unavailable');
    binding = loaded;
  } catch {
    return unavailable('native-unavailable');
  }

  return {
    availability: () => {
      try {
        return normalizeAvailability(binding.availability(EXPECTED_BUNDLE_ID));
      } catch {
        return { available: false, reason: 'native-unavailable' };
      }
    },
    store: async (account, secret) => {
      validAccount(account);
      if (secret.length !== 32) throw new TouchIdAdapterError('storage-failure');
      try {
        await binding.store(EXPECTED_BUNDLE_ID, account, secret);
      } catch (error) {
        throw mappedError(error);
      }
    },
    read: async (account, reason) => {
      validAccount(account);
      if (reason.length === 0) throw new TouchIdAdapterError('storage-failure');
      try {
        const secret = await binding.read(EXPECTED_BUNDLE_ID, account, reason);
        if (!Buffer.isBuffer(secret) || secret.length !== 32) {
          if (Buffer.isBuffer(secret)) secret.fill(0);
          throw new TouchIdAdapterError('storage-failure');
        }
        return secret;
      } catch (error) {
        throw mappedError(error);
      }
    },
    clear: async (account) => {
      validAccount(account);
      try {
        await binding.clear(EXPECTED_BUNDLE_ID, account);
      } catch (error) {
        throw mappedError(error);
      }
    },
  };
}
