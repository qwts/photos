import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createNativeTouchIdAdapter } from '../../src/main/crypto/touch-id-native.js';
import { TouchIdAdapterError } from '../../src/main/crypto/touch-id.js';

const ACCOUNT = `v1:${'a'.repeat(64)}`;
const U = Buffer.alloc(32, 0x55);

function nativeBinding() {
  const calls: Array<readonly [string, ...unknown[]]> = [];
  let availabilityResult: unknown = { available: true, reason: null };
  let readResult: unknown = Buffer.from(U);
  let operationError: Error | undefined;
  const fail = (): void => {
    if (operationError !== undefined) throw operationError;
  };
  return {
    calls,
    setAvailability: (value: unknown) => {
      availabilityResult = value;
    },
    setRead: (value: unknown) => {
      readResult = value;
    },
    setError: (value: Error) => {
      operationError = value;
    },
    binding: {
      availability: (bundleId: string) => {
        calls.push(['availability', bundleId]);
        return availabilityResult;
      },
      store: (bundleId: string, account: string, secret: Buffer) => {
        fail();
        calls.push(['store', bundleId, account, Buffer.from(secret)]);
        return Promise.resolve();
      },
      read: (bundleId: string, account: string, reason: string) => {
        fail();
        calls.push(['read', bundleId, account, reason]);
        return Promise.resolve(readResult);
      },
      clear: (bundleId: string, account: string) => {
        fail();
        calls.push(['clear', bundleId, account]);
        return Promise.resolve();
      },
    },
  };
}

describe('native Touch ID adapter gating (#310)', () => {
  test('unsupported and unpackaged processes never load the native module', () => {
    let loads = 0;
    const loadBinding = () => {
      loads += 1;
      return nativeBinding().binding;
    };
    const unsupported = createNativeTouchIdAdapter({ platform: 'win32', packaged: true, loadBinding });
    const unsigned = createNativeTouchIdAdapter({ platform: 'darwin', packaged: false, loadBinding });
    assert.deepEqual(unsupported.availability(), { available: false, reason: 'unsupported-platform' });
    assert.deepEqual(unsigned.availability(), { available: false, reason: 'unsigned-build' });
    assert.equal(loads, 0);
  });

  test('missing, malformed, or throwing native modules fail closed', () => {
    const missing = createNativeTouchIdAdapter({
      platform: 'darwin',
      packaged: true,
      loadBinding: () => {
        throw new Error('not installed');
      },
    });
    const malformed = createNativeTouchIdAdapter({ platform: 'darwin', packaged: true, loadBinding: () => ({}) });
    assert.deepEqual(missing.availability(), { available: false, reason: 'native-unavailable' });
    assert.deepEqual(malformed.availability(), { available: false, reason: 'native-unavailable' });
  });
});

describe('native Touch ID adapter contract (#310)', () => {
  test('passes the fixed bundle identity and preserves native availability states', async () => {
    const native = nativeBinding();
    const adapter = createNativeTouchIdAdapter({ platform: 'darwin', packaged: true, loadBinding: () => native.binding });
    assert.deepEqual(adapter.availability(), { available: true, reason: null });
    native.setAvailability({ available: false, reason: 'not-enrolled' });
    assert.deepEqual(adapter.availability(), { available: false, reason: 'not-enrolled' });

    await adapter.store(ACCOUNT, U);
    assert.deepEqual(await adapter.read(ACCOUNT, 'Unlock Overlook'), U);
    await adapter.clear(ACCOUNT);
    assert.deepEqual(native.calls, [
      ['availability', 'com.qwts.overlook'],
      ['availability', 'com.qwts.overlook'],
      ['store', 'com.qwts.overlook', ACCOUNT, U],
      ['read', 'com.qwts.overlook', ACCOUNT, 'Unlock Overlook'],
      ['clear', 'com.qwts.overlook', ACCOUNT],
    ]);
  });

  test('rejects malformed native data and maps only stable error codes', async () => {
    const native = nativeBinding();
    const adapter = createNativeTouchIdAdapter({ platform: 'darwin', packaged: true, loadBinding: () => native.binding });
    native.setAvailability({ available: 'yes', reason: null });
    assert.deepEqual(adapter.availability(), { available: false, reason: 'native-unavailable' });
    native.setRead(Buffer.alloc(31));
    await assert.rejects(adapter.read(ACCOUNT, 'Unlock Overlook'), errorWithCode('storage-failure'));
    native.setError(Object.assign(new Error('native detail must not cross the boundary'), { code: 'cancelled' }));
    await assert.rejects(adapter.read(ACCOUNT, 'Unlock Overlook'), errorWithCode('cancelled'));
    native.setError(new Error('unknown'));
    await assert.rejects(adapter.clear(ACCOUNT), errorWithCode('unavailable'));
  });

  test('rejects malformed accounts, secrets, and reasons before native custody', async () => {
    const native = nativeBinding();
    const adapter = createNativeTouchIdAdapter({ platform: 'darwin', packaged: true, loadBinding: () => native.binding });
    await assert.rejects(adapter.store('wrong', U), errorWithCode('storage-failure'));
    await assert.rejects(adapter.store(ACCOUNT, Buffer.alloc(31)), errorWithCode('storage-failure'));
    await assert.rejects(adapter.read(ACCOUNT, ''), errorWithCode('storage-failure'));
    assert.equal(native.calls.length, 0);
  });
});

function errorWithCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof TouchIdAdapterError && error.code === code && error.message === 'Touch ID operation failed';
}
