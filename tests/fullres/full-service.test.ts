import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { BlobStore } from '../../src/main/blobs/blob-store.js';
import { FullService, type LoadedOriginal } from '../../src/main/fullres/full-service.js';
import { embeddedJpegFromRaf, looksLikeJpeg } from '../../src/main/import/raf-preview.js';
import { sampleJpeg } from '../../src/main/library/seed.js';
import { FULL_SCHEME, fullUrl, parseFullUrl } from '../../src/shared/library/full-url.js';
import type { EnvelopeKey } from '../../src/main/crypto/envelope.js';
import type { FileKind } from '../../src/shared/library/types.js';

function original(bytes: Buffer, fileKind: FileKind, hash = 'h'): LoadedOriginal {
  return { bytes, contentHash: hash, fileKind };
}

/** Deterministic junk — undecodable as any image format. Deliberately NOT
 * crypto randomness: CodeQL taint-tracks randomBytes into the RAF header
 * arithmetic and misreads format parsing as biased crypto. */
function junkBytes(length: number): Buffer {
  return Buffer.from(Array.from({ length }, (_, index) => (index * 131 + 7) % 256));
}

/** A minimal RAF container: magic header + documented offsets to `jpeg`. */
function rafContaining(jpeg: Buffer): Buffer {
  const header = Buffer.alloc(100);
  header.write('FUJIFILMCCD-RAW ', 0, 'ascii');
  header.writeUInt32BE(100, 84); // embedded JPEG offset
  header.writeUInt32BE(jpeg.length, 88); // embedded JPEG length
  return Buffer.concat([header, jpeg]);
}

describe('full-res URL contract (#91)', () => {
  test('build/parse round-trips and preserves id case', () => {
    const url = fullUrl('01J8SEEDPHOTO0001');
    assert.equal(url, `${FULL_SCHEME}://library/01J8SEEDPHOTO0001`);
    assert.deepEqual(parseFullUrl(url), { photoId: '01J8SEEDPHOTO0001', prefetch: false });
    assert.deepEqual(parseFullUrl(fullUrl('AbC', { prefetch: true })), { photoId: 'AbC', prefetch: true });
  });

  test('rejects malformed urls', () => {
    assert.equal(parseFullUrl('not a url'), null);
    assert.equal(parseFullUrl('https://library/01J8'), null);
    assert.equal(parseFullUrl(`${FULL_SCHEME}://other/01J8`), null);
    assert.equal(parseFullUrl(`${FULL_SCHEME}://library/a/b`), null);
    assert.equal(parseFullUrl(`${FULL_SCHEME}://library/`), null);
  });
});

describe('RAF preview extraction', () => {
  test('resolves the documented embedded JPEG and rejects broken headers', () => {
    const jpeg = sampleJpeg(3);
    assert.deepEqual(embeddedJpegFromRaf(rafContaining(jpeg)), jpeg);
    assert.equal(embeddedJpegFromRaf(Buffer.from('FUJIFILMCCD-RAW but far too short')), null);
    assert.equal(embeddedJpegFromRaf(jpeg), null, 'a JPEG is not a RAF');
    const lying = rafContaining(jpeg);
    lying.writeUInt32BE(9999, 88); // length pointing past the file
    assert.equal(embeddedJpegFromRaf(lying), null);
  });

  test('looksLikeJpeg sniffs SOI, not extensions', () => {
    assert.equal(looksLikeJpeg(sampleJpeg(0)), true);
    assert.equal(looksLikeJpeg(Buffer.from('RIFFxxxxWEBP')), false);
    assert.equal(looksLikeJpeg(Buffer.alloc(1)), false);
  });
});

describe('FullService (#91)', () => {
  test('EXIT CRITERIA: RAW records resolve to a preview-marked viewable payload', async () => {
    const jpeg = sampleJpeg(1);
    const service = new FullService({
      loadOriginal: (photoId) =>
        Promise.resolve(photoId === 'raf' ? original(rafContaining(jpeg), 'raw', 'rafhash') : original(jpeg, 'raw', 'jpghash')),
    });
    const fromRaf = await service.getFull('raf');
    assert.deepEqual(fromRaf, { bytes: jpeg, contentHash: 'rafhash', mime: 'image/jpeg', preview: true });
    // A raw record whose bytes are already JPEG (dev seeds) serves as-is.
    const fromJpegBytes = await service.getFull('seedraw');
    assert.equal(fromJpegBytes?.preview, true);
    assert.deepEqual(fromJpegBytes?.bytes, jpeg);
  });

  test('a RAW with no viewable payload is a placeholder (null), never a throw', async () => {
    const service = new FullService({
      loadOriginal: () => Promise.resolve(original(junkBytes(64), 'raw')),
    });
    assert.equal(await service.getFull('cr2'), null);
  });

  test('mime follows the record kind; unknown kinds are placeholders', async () => {
    const kinds: LoadedOriginal[] = [
      original(sampleJpeg(0), 'jpeg'),
      original(junkBytes(8), 'png'),
      original(junkBytes(8), 'heic'),
      original(junkBytes(8), 'other'),
    ];
    const service = new FullService({
      loadOriginal: (photoId) => Promise.resolve(kinds[Number(photoId)] ?? null),
    });
    assert.equal((await service.getFull('0'))?.mime, 'image/jpeg');
    assert.equal((await service.getFull('0'))?.preview, false);
    assert.equal((await service.getFull('1'))?.mime, 'image/png');
    assert.equal((await service.getFull('2'))?.mime, 'image/heic');
    assert.equal(await service.getFull('3'), null);
    assert.equal(await service.getFull('4'), null, 'missing photo');
  });

  test('EXIT CRITERIA: decrypted buffers stay under the byte budget (LRU-evicted)', async () => {
    let loads = 0;
    const service = new FullService({
      loadOriginal: (photoId) => {
        loads += 1;
        return Promise.resolve(original(sampleJpeg(0), 'jpeg', photoId));
      },
      // Room for two ~800-byte entries — the third load must evict.
      maxCacheBytes: sampleJpeg(0).length * 2 + 100,
    });
    // 20 rapid next/prev over a window of ids far larger than the budget.
    for (let step = 0; step < 20; step += 1) {
      await service.getFull(`photo-${String(step % 7)}`);
      assert.ok(service.stats().cachedBytes <= sampleJpeg(0).length * 2 + 100, `budget respected at step ${String(step)}`);
    }
    assert.ok(loads > 7, 'eviction forced reloads — the cache really is bounded');
    // Repeats of the most recent id hit the cache.
    const before = loads;
    await service.getFull('photo-5');
    assert.equal(loads, before);
  });

  test('concurrent requests for one photo share a single decrypt', async () => {
    let loads = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new FullService({
      loadOriginal: async () => {
        loads += 1;
        await gate;
        return original(sampleJpeg(2), 'jpeg');
      },
    });
    const first = service.getFull('a');
    const second = service.getFull('a');
    release?.();
    const [r1, r2] = await Promise.all([first, second]);
    assert.equal(loads, 1);
    assert.deepEqual(r1, r2);
  });

  test('EXIT CRITERIA: rapid paging — aborted-while-queued requests never decrypt', async () => {
    const releases: (() => void)[] = [];
    const service = new FullService({
      loadOriginal: async () => {
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        return original(sampleJpeg(0), 'jpeg');
      },
      maxConcurrent: 2,
    });
    const controller = new AbortController();
    const first = service.getFull('a');
    const second = service.getFull('b');
    const third = service.getFull('c', controller.signal); // queued
    controller.abort(); // paged past before a slot freed
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(releases.length, 2, 'the aborted decrypt never started');
    releases.forEach((release) => {
      release();
    });
    const [r1, r2, r3] = await Promise.all([first, second, third]);
    assert.notEqual(r1, null);
    assert.notEqual(r2, null);
    assert.equal(r3, null);
  });

  test('a still-interested join keeps an aborted waiter’s queued decrypt alive', async () => {
    // Rapid prev/next can land BACK on an id whose first requester already
    // paged away: the joined request must not inherit that abort (PR #179
    // review) — one live waiter keeps the load going.
    const releases: (() => void)[] = [];
    let loads = 0;
    const service = new FullService({
      loadOriginal: async () => {
        loads += 1;
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        return original(sampleJpeg(6), 'jpeg');
      },
      maxConcurrent: 1,
    });
    const controller = new AbortController();
    const blocker = service.getFull('x'); // occupies the only decrypt slot
    const abandoned = service.getFull('y', controller.signal); // queued
    const joined = service.getFull('y'); // same id, no signal — still wanted
    controller.abort(); // first requester pages away
    await new Promise((resolve) => setImmediate(resolve)); // x's decrypt starts
    releases[0]?.();
    await new Promise((resolve) => setImmediate(resolve)); // slot frees; y starts
    releases[1]?.();
    const [, rAbandoned, rJoined] = await Promise.all([blocker, abandoned, joined]);
    assert.notEqual(rJoined, null, 'the live waiter got the decrypt');
    assert.deepEqual(rAbandoned, rJoined, 'joined callers share one resolution');
    assert.equal(loads, 2, 'x and y each decrypted exactly once');
  });

  test('prefetch warms the cache once per id and swallows results', async () => {
    let loads = 0;
    const service = new FullService({
      loadOriginal: () => {
        loads += 1;
        return Promise.resolve(original(sampleJpeg(4), 'jpeg'));
      },
    });
    service.prefetch(['n1', 'n2', 'n1']); // duplicate joins the in-flight load
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(loads, 2);
    await service.getFull('n1'); // already decrypted — no third load
    assert.equal(loads, 2);
  });

  test('EXIT CRITERIA: real-store originals decrypt in memory, never touch disk', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'overlook-fullsvc-'));
    const store = new BlobStore({ dataDir });
    await store.init();
    const key: EnvelopeKey = { id: 1, key: randomBytes(32) };
    const jpeg = sampleJpeg(9);
    const ref = await store.putOriginal(Readable.from([jpeg]), key, 'PHOTO9');

    const snapshot = readdirSync(dataDir, { recursive: true }).sort();
    const service = new FullService({
      loadOriginal: async (photoId) => ({
        bytes: await buffer(store.getStream(ref.contentHash, () => key.key, photoId)),
        contentHash: ref.contentHash,
        fileKind: 'jpeg',
      }),
    });
    const payload = await service.getFull('PHOTO9');
    assert.deepEqual(payload?.bytes, jpeg, 'decrypted original matches the plaintext');
    await service.getFull('PHOTO9');
    assert.deepEqual(readdirSync(dataDir, { recursive: true }).sort(), snapshot, 'no new files from reads');
  });
});
