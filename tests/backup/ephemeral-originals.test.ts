import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { EphemeralOriginalError, EphemeralOriginalService } from '../../src/main/backup/ephemeral-originals.js';
import { MockProvider } from '../../src/main/backup/mock-provider.js';
import type { SyncStatus } from '../../src/shared/library/types.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

async function world(options: { readonly maxCacheBytes?: number; readonly policy?: boolean } = {}) {
  const provider = new MockProvider({ rootDir: mkdtempSync(join(tmpdir(), 'overlook-ephemeral-')) });
  const remote = new Map([
    [HASH_A, Buffer.from('encrypted-a')],
    [HASH_B, Buffer.from('encrypted-bb')],
    [HASH_C, Buffer.from('encrypted-ccc')],
  ]);
  for (const [hash, bytes] of remote) await provider.put(`blobs/${hash.slice(0, 2)}/${hash}`, Readable.from([bytes]));
  let getCalls = 0;
  const getStream = provider.getStream.bind(provider);
  provider.getStream = (path) => {
    getCalls += 1;
    return getStream(path);
  };
  const photos = new Map([
    ['P0', { contentHash: HASH_A }],
    ['P1', { contentHash: HASH_A }],
    ['P2', { contentHash: HASH_B }],
    ['P3', { contentHash: HASH_C }],
  ]);
  const statuses = new Map<string, SyncStatus>([...photos.keys()].map((id) => [id, 'offloaded']));
  const ephemeral = new Map<string, Buffer>();
  const durable = new Set<string>();
  const states: { photoId: string; stage: string }[] = [];
  const syncUpdates: { id: string; syncState: SyncStatus }[][] = [];
  const work: number[] = [];
  let storageChanges = 0;
  let permanentRestores = 0;
  let policy = options.policy ?? true;
  const service = new EphemeralOriginalService({
    provider,
    providerConnected: () => true,
    ledger: {
      status: (id) => statuses.get(id),
      setStatus: (id, status) => statuses.set(id, status),
    },
    repo: { get: (id) => photos.get(id) },
    blobs: {
      hasOriginal: (hash) => durable.has(hash),
      durableStream: (hash) => Readable.from([Buffer.from(`durable-${hash}`)]),
      hasEphemeral: (hash) => ephemeral.has(hash),
      stageEphemeral: async (hash, ciphertext) => {
        const bytes = await buffer(ciphertext);
        ephemeral.set(hash, bytes);
        return bytes.length;
      },
      ephemeralStream: (hash) => Readable.from([ephemeral.get(hash) ?? Buffer.alloc(0)]),
      promoteEphemeral: (hash) => {
        durable.add(hash);
        return Promise.resolve();
      },
      deleteEphemeral: (hash) => {
        ephemeral.delete(hash);
        return Promise.resolve();
      },
    },
    reOffloadAfterViewing: () => policy,
    permanentRestore: (photoId) => {
      permanentRestores += 1;
      const photo = photos.get(photoId);
      if (photo !== undefined) durable.add(photo.contentHash);
      statuses.set(photoId, 'synced');
      return Promise.resolve();
    },
    workChanged: (delta) => work.push(delta),
    syncStateChanged: (updates) => syncUpdates.push([...updates]),
    storageChanged: () => (storageChanges += 1),
    stateChanged: (state) => states.push(state),
    audit: () => undefined,
    maxCacheBytes: options.maxCacheBytes,
  });
  return {
    provider,
    service,
    statuses,
    ephemeral,
    durable,
    states,
    syncUpdates,
    work,
    getCalls: () => getCalls,
    storageChanges: () => storageChanges,
    permanentRestores: () => permanentRestores,
    setPolicy: (next: boolean) => (policy = next),
  };
}

describe('ephemeral originals (#306)', () => {
  test('concurrent shared-hash opens download once and release respects active owners', async () => {
    const w = await world();
    const [first, second] = await Promise.all([w.service.open('P0', 'view'), w.service.open('P1', 'view')]);
    assert.equal(first.custody, 'ephemeral');
    assert.equal(second.custody, 'ephemeral');
    assert.equal(w.getCalls(), 1, 'content-addressed in-flight fetch is shared');
    assert.equal(w.statuses.get('P0'), 'offloaded');
    assert.equal(w.statuses.get('P1'), 'offloaded');
    assert.deepEqual(w.work, [1, -1]);

    await w.service.release('P0');
    assert.equal(w.ephemeral.has(HASH_A), true, 'the second viewer still owns custody');
    await w.service.release('P1');
    assert.equal(w.ephemeral.has(HASH_A), false);
    assert.equal(w.service.stats().cachedBytes, 0);
  });

  test('Keep downloaded promotes verified ciphertext before transitioning the ledger', async () => {
    const w = await world();
    await w.service.open('P0', 'view');
    await w.service.keepDownloaded('P0');
    assert.equal(w.durable.has(HASH_A), true);
    assert.equal(w.statuses.get('P0'), 'synced');
    assert.deepEqual(w.syncUpdates, [[{ id: 'P0', syncState: 'synced' }]]);
    assert.equal(w.storageChanges(), 1);
    assert.equal(w.ephemeral.has(HASH_A), false);
  });

  test('policy off uses permanent restore; prefetch stays temporary and LRU-bounded', async () => {
    const w = await world({ maxCacheBytes: 20 });
    w.setPolicy(false);
    assert.equal((await w.service.open('P0', 'view')).custody, 'durable');
    assert.equal(w.permanentRestores(), 1);
    w.setPolicy(true);
    await w.service.open('P2', 'prefetch');
    await w.service.open('P3', 'prefetch');
    assert.equal(w.ephemeral.has(HASH_B), false, 'old inactive prefetch evicted to make room');
    assert.equal(w.ephemeral.has(HASH_C), true);
    assert.ok(w.service.stats().cachedBytes <= 20);
  });

  test('oversized and missing remote originals fail closed without cached custody', async () => {
    const oversized = await world({ maxCacheBytes: 2 });
    await assert.rejects(
      oversized.service.open('P0', 'view'),
      (error: unknown) => error instanceof EphemeralOriginalError && error.reason === 'cache-full',
    );
    assert.equal(oversized.ephemeral.size, 0);

    const missing = await world();
    await missing.provider.delete(`blobs/${HASH_A.slice(0, 2)}/${HASH_A}`);
    await assert.rejects(
      missing.service.open('P0', 'view'),
      (error: unknown) => error instanceof EphemeralOriginalError && error.reason === 'remote-missing',
    );
    assert.equal(missing.ephemeral.size, 0);
    assert.equal(missing.states.at(-1)?.stage, 'error');
  });
});
