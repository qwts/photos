import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { BlobStore } from '../../src/main/blobs/blob-store.js';
import type { EnvelopeKey } from '../../src/main/crypto/envelope.js';
import { sampleJpeg } from '../../src/main/library/seed.js';
import { ThumbService, type LoadedThumb } from '../../src/main/thumbs/thumb-service.js';
import { handleThumbRequest } from '../../src/main/thumbs/thumb-response.js';
import { parseThumbUrl, thumbUrl, THUMB_SCHEME } from '../../src/shared/library/thumb-url.js';

function loaded(size: number, hash = 'h'): LoadedThumb {
  return { bytes: Buffer.alloc(size, 1), contentHash: hash };
}

describe('thumb URL contract', () => {
  test('build/parse round-trips and preserves id case', () => {
    const url = thumbUrl('01J8SEEDPHOTO0001');
    assert.equal(url, `${THUMB_SCHEME}://library/01J8SEEDPHOTO0001?size=thumb`);
    assert.deepEqual(parseThumbUrl(url), { photoId: '01J8SEEDPHOTO0001', size: 'thumb' });
    assert.deepEqual(parseThumbUrl(thumbUrl('AbC', 'mid')), { photoId: 'AbC', size: 'mid' });
  });

  test('rejects malformed urls', () => {
    assert.equal(parseThumbUrl('not a url'), null);
    assert.equal(parseThumbUrl('https://library/01J8?size=thumb'), null);
    assert.equal(parseThumbUrl(`${THUMB_SCHEME}://other/01J8?size=thumb`), null);
    assert.equal(parseThumbUrl(`${THUMB_SCHEME}://library/a/b?size=thumb`), null);
    assert.equal(parseThumbUrl(`${THUMB_SCHEME}://library/01J8?size=huge`), null);
    assert.equal(parseThumbUrl(`${THUMB_SCHEME}://library/?size=thumb`), null);
  });

  test('protocol responses never let Chromium cache decrypted thumbs across lock', async () => {
    const service = new ThumbService({ loadThumb: () => Promise.resolve(loaded(3)) });
    const success = await handleThumbRequest(
      () => service,
      () => undefined,
      new Request(thumbUrl('a')),
    );
    assert.equal(success.status, 200);
    assert.equal(success.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await success.arrayBuffer()), Buffer.alloc(3, 1));

    const denied = await handleThumbRequest(
      () => service,
      () => {
        throw new Error('locked');
      },
      new Request(thumbUrl('a')),
    );
    assert.equal(denied.status, 404);
    assert.equal(denied.headers.get('cache-control'), 'no-store');
  });

  test('locked requests cannot construct the thumbnail service', async () => {
    let serviceLookups = 0;
    const denied = await handleThumbRequest(
      () => {
        serviceLookups += 1;
        return new ThumbService({ loadThumb: () => Promise.resolve(loaded(3)) });
      },
      () => {
        throw new Error('locked');
      },
      new Request(thumbUrl('a')),
    );

    assert.equal(denied.status, 404);
    assert.equal(serviceLookups, 0);
  });
});

describe('ThumbService', () => {
  test('caches decrypts and serves repeats without reloading', async () => {
    let loads = 0;
    const service = new ThumbService({
      loadThumb: () => {
        loads += 1;
        return Promise.resolve(loaded(100));
      },
    });
    await service.getThumb('a', 'thumb');
    const again = await service.getThumb('a', 'thumb');
    assert.equal(loads, 1);
    assert.equal(again?.bytes.length, 100);
    // Sizes cache independently.
    await service.getThumb('a', 'mid');
    assert.equal(loads, 2);
  });

  test('LRU evicts oldest entries past the byte cap, refreshing on hit', async () => {
    const service = new ThumbService({
      loadThumb: (photoId) => Promise.resolve(loaded(400, photoId)),
      maxCacheBytes: 1000,
    });
    await service.getThumb('a', 'thumb');
    await service.getThumb('b', 'thumb');
    await service.getThumb('a', 'thumb'); // refresh a: recency is now b < a
    await service.getThumb('c', 'thumb'); // 1200 bytes: evicts b (oldest)
    assert.equal(service.stats().cachedBytes, 800);
    // a and c hit the cache; b was evicted and reloads, evicting a in turn.
    assert.equal((await service.getThumb('a', 'thumb'))?.contentHash, 'a');
    assert.equal((await service.getThumb('c', 'thumb'))?.contentHash, 'c');
    assert.equal(service.stats().cachedBytes, 800);
    await service.getThumb('b', 'thumb');
    assert.equal(service.stats().cachedBytes, 800);
  });

  test('a thumb larger than the whole cache serves without caching', async () => {
    const service = new ThumbService({
      loadThumb: () => Promise.resolve(loaded(5000)),
      maxCacheBytes: 1000,
    });
    const result = await service.getThumb('big', 'thumb');
    assert.equal(result?.bytes.length, 5000);
    assert.equal(service.stats().cachedBytes, 0);
  });

  test('concurrent requests for the same thumb share one decrypt', async () => {
    let loads = 0;
    let releaseLoad: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const service = new ThumbService({
      loadThumb: async () => {
        loads += 1;
        await gate;
        return loaded(10);
      },
    });
    const first = service.getThumb('a', 'thumb');
    const second = service.getThumb('a', 'thumb');
    releaseLoad?.();
    const [r1, r2] = await Promise.all([first, second]);
    assert.equal(loads, 1);
    assert.equal(r1?.bytes.length, 10);
    assert.equal(r2?.bytes.length, 10);
  });

  test('close drains loads, zeroizes plaintext, and rejects later admission', async () => {
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new ThumbService({
      loadThumb: async () => {
        entered?.();
        await gate;
        return loaded(10);
      },
    });
    const pending = service.getThumb('a', 'thumb');
    await started;
    const closing = service.close();
    release?.();
    const result = await pending;
    await closing;

    assert.deepEqual(result?.bytes, Buffer.alloc(10), 'the in-flight plaintext was zeroized before teardown completed');
    assert.equal(service.stats().cachedBytes, 0);
    assert.equal(await service.getThumb('b', 'thumb'), null);
  });

  test('decrypt concurrency is capped; queued aborts never load', async () => {
    const releases: (() => void)[] = [];
    const service = new ThumbService({
      loadThumb: async () => {
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        return loaded(10);
      },
      maxConcurrent: 2,
    });
    const controller = new AbortController();
    const first = service.getThumb('a', 'thumb');
    const second = service.getThumb('b', 'thumb');
    const third = service.getThumb('c', 'thumb', controller.signal); // queued
    controller.abort(); // scrolled past before a slot freed
    await new Promise((resolve) => setImmediate(resolve)); // let jobs reach their gates
    assert.equal(service.stats().peakConcurrent, 2);
    assert.equal(releases.length, 2, 'third decrypt never started');
    releases.forEach((release) => {
      release();
    });
    const [r1, r2, r3] = await Promise.all([first, second, third]);
    assert.notEqual(r1, null);
    assert.notEqual(r2, null);
    assert.equal(r3, null, 'aborted-in-queue resolves null without loading');
    assert.equal(releases.length, 2);
  });

  test('close drops queued decrypts before their loader starts', async () => {
    let releaseActive: (() => void) | undefined;
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    let loads = 0;
    const service = new ThumbService({
      loadThumb: async () => {
        loads += 1;
        await activeGate;
        return loaded(10);
      },
      maxConcurrent: 1,
    });
    const active = service.getThumb('a', 'thumb');
    const queued = service.getThumb('b', 'thumb');
    await new Promise((resolve) => setImmediate(resolve));

    const closing = service.close();
    releaseActive?.();
    const [, queuedResult] = await Promise.all([active, queued]);
    await closing;

    assert.equal(queuedResult, null);
    assert.equal(loads, 1);
  });

  test('EXIT CRITERIA: real-store reads decrypt in memory, never touch disk', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'overlook-thumbsvc-'));
    const store = new BlobStore({ dataDir });
    await store.init();
    const key: EnvelopeKey = { id: 1, key: randomBytes(32) };
    const jpeg = sampleJpeg(7);
    const ref = await store.putOriginal(Readable.from([jpeg]), key, 'PHOTO7');
    await store.putThumb(Readable.from([jpeg]), key, 'PHOTO7', ref.contentHash, 'thumb');

    const snapshot = readdirSync(dataDir, { recursive: true }).sort();
    const service = new ThumbService({
      loadThumb: async (photoId, size) => ({
        bytes: await buffer(store.getThumbStream(ref.contentHash, size, () => key.key, photoId)),
        contentHash: ref.contentHash,
      }),
    });
    const first = await service.getThumb('PHOTO7', 'thumb');
    assert.deepEqual(first?.bytes, jpeg, 'decrypted thumb matches the plaintext');
    await service.getThumb('PHOTO7', 'thumb');
    assert.deepEqual(readdirSync(dataDir, { recursive: true }).sort(), snapshot, 'no new files from reads');
  });

  test('missing thumbs are not cached (M05 backfill must be visible)', async () => {
    let loads = 0;
    const service = new ThumbService({
      loadThumb: () => {
        loads += 1;
        return Promise.resolve(loads === 1 ? null : loaded(10));
      },
    });
    assert.equal(await service.getThumb('a', 'thumb'), null);
    const second = await service.getThumb('a', 'thumb');
    assert.equal(second?.bytes.length, 10);
    assert.equal(loads, 2);
  });
});
