import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { FaultInjectingProvider, MockProvider, ProviderRegistry } from '../../src/main/backup/mock-provider.js';
import { ProviderError } from '../../src/main/backup/provider.js';

// #103 exit criteria: the contract suite runs green against the mock, and
// fault injection produces each error path the engine must handle. The same
// suite is the bar for the pCloud adapter (#109).

function world(totalBytes?: number) {
  const provider = new MockProvider({ rootDir: mkdtempSync(join(tmpdir(), 'overlook-mock-remote-')), totalBytes });
  return { provider, faulty: new FaultInjectingProvider(provider) };
}

const PAYLOAD = Buffer.from('OVLK-envelope-bytes-already-encrypted');

describe('storage provider contract (#103)', () => {
  test('EXIT CRITERIA: put → list → get → verify → delete round-trip', async () => {
    const { provider } = world();
    const path = 'blobs/ab/abcdef';
    const put = await provider.put(path, Readable.from([PAYLOAD]));
    assert.equal(put.bytes, PAYLOAD.length);

    const listed = await provider.list('blobs');
    assert.deepEqual(listed, [{ path, bytes: PAYLOAD.length }]);

    assert.deepEqual(await buffer(await provider.getStream(path)), PAYLOAD, 'bytes travel as-is (ADR-0007)');

    const verified = await provider.verify(path);
    assert.equal(verified.sha256, createHash('sha256').update(PAYLOAD).digest('hex'));
    assert.equal(verified.bytes, PAYLOAD.length);

    await provider.delete(path);
    assert.deepEqual(await provider.list('blobs'), []);
    await assert.rejects(provider.getStream(path), (error: unknown) => error instanceof ProviderError && error.kind === 'not-found');
  });

  test('unsafe remote paths are rejected outright', async () => {
    const { provider } = world();
    for (const bad of ['/abs', 'a/../b', '', 'a//b', 'a\\..\\outside', 'C:/evil']) {
      await assert.rejects(
        provider.put(bad, Readable.from([PAYLOAD])),
        (error: unknown) => error instanceof ProviderError && error.kind === 'corrupt',
      );
    }
  });

  test('quota simulation: an over-quota put fails with kind=quota and leaves nothing behind', async () => {
    const { provider } = world(10);
    await assert.rejects(
      provider.put('blobs/xx/big', Readable.from([PAYLOAD])),
      (error: unknown) => error instanceof ProviderError && error.kind === 'quota',
    );
    assert.deepEqual(await provider.list('blobs'), []);
    const quota = await provider.quota();
    assert.deepEqual(quota, { usedBytes: 0, totalBytes: 10 });

    // Replacements compare FINAL usage: an 8-byte object replaced by a
    // 6-byte one fits a 10-byte quota even though 8 + 6 > 10.
    await provider.put('blobs/aa/x', Readable.from([Buffer.alloc(8)]));
    await provider.put('blobs/aa/x', Readable.from([Buffer.alloc(6)]));
    assert.equal((await provider.quota()).usedBytes, 6);
  });

  test('disconnect: every data call fails with kind=auth; state feeds the registry', async () => {
    const { provider } = world();
    provider.setConnected(false);
    assert.equal(await provider.authState(), 'not-connected');
    await assert.rejects(
      provider.put('blobs/aa/x', Readable.from([PAYLOAD])),
      (error: unknown) => error instanceof ProviderError && error.kind === 'auth',
    );
    await assert.rejects(provider.quota(), (error: unknown) => error instanceof ProviderError && error.kind === 'auth');

    const registry = new ProviderRegistry();
    registry.register(provider);
    assert.deepEqual(await registry.connectionStates(), [{ id: 'mock', label: 'Local mock', state: 'not-connected' }]);
  });

  test('EXIT CRITERIA: fault injection produces each engine error path', async () => {
    const { provider, faulty } = world();
    await provider.put('blobs/aa/keep', Readable.from([PAYLOAD]));

    faulty.arm('put');
    await assert.rejects(
      faulty.put('blobs/aa/new', Readable.from([PAYLOAD])),
      (error: unknown) => error instanceof ProviderError && error.kind === 'transient',
    );
    faulty.disarm('put');

    faulty.arm('verify-mismatch');
    const lied = await faulty.verify('blobs/aa/keep');
    assert.notEqual(lied.sha256, createHash('sha256').update(PAYLOAD).digest('hex'), 'the verify bit must be able to fail');
    faulty.disarm('verify-mismatch');

    faulty.arm('transient-get');
    await assert.rejects(
      faulty.getStream('blobs/aa/keep'),
      (error: unknown) => error instanceof ProviderError && error.kind === 'transient',
    );
    faulty.disarm('transient-get');

    faulty.arm('auth-expired');
    assert.equal(await faulty.authState(), 'expired');
    await assert.rejects(
      faulty.put('blobs/aa/other', Readable.from([PAYLOAD])),
      (error: unknown) => error instanceof ProviderError && error.kind === 'auth',
    );
    faulty.disarm('auth-expired');

    // Recovery: with faults disarmed the same paths work again.
    assert.deepEqual(await buffer(await faulty.getStream('blobs/aa/keep')), PAYLOAD);
  });
});
