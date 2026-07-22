import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { resolveByteRange } from '../../src/main/fullres/byte-range.js';
import { sliceStream, videoHeaders } from '../../src/main/fullres/video-stream.js';
import { FullService, type VideoOriginal } from '../../src/main/fullres/full-service.js';

describe('resolveByteRange (ADR-0026 §5)', () => {
  test('absent header is a full 200', () => {
    assert.deepEqual(resolveByteRange(null, 100), { kind: 'full' });
    assert.deepEqual(resolveByteRange('', 100), { kind: 'full' });
  });

  test('closed, open, and suffix ranges clamp to the file', () => {
    assert.deepEqual(resolveByteRange('bytes=0-9', 100), { kind: 'partial', start: 0, end: 9 });
    assert.deepEqual(resolveByteRange('bytes=90-', 100), { kind: 'partial', start: 90, end: 99 });
    assert.deepEqual(resolveByteRange('bytes=50-999', 100), { kind: 'partial', start: 50, end: 99 });
    assert.deepEqual(resolveByteRange('bytes=-20', 100), { kind: 'partial', start: 80, end: 99 });
  });

  test('malformed or out-of-bounds ranges are unsatisfiable', () => {
    assert.deepEqual(resolveByteRange('bytes=100-200', 100), { kind: 'unsatisfiable' });
    assert.deepEqual(resolveByteRange('bytes=20-10', 100), { kind: 'unsatisfiable' });
    assert.deepEqual(resolveByteRange('items=0-9', 100), { kind: 'unsatisfiable' });
    assert.deepEqual(resolveByteRange('bytes=-0', 100), { kind: 'unsatisfiable' });
    assert.deepEqual(resolveByteRange('bytes=0-9', 0), { kind: 'unsatisfiable' });
  });
});

describe('sliceStream — bounded window over a decrypting read', () => {
  const source = (): Readable => Readable.from([Buffer.from('ABCDE'), Buffer.from('FGHIJ')]);

  test('extracts an interior window across chunk boundaries', async () => {
    const out = await buffer(sliceStream(source(), 3, 4)); // DEFG
    assert.equal(out.toString(), 'DEFG');
  });

  test('a leading window stops early without draining the source', async () => {
    const out = await buffer(sliceStream(source(), 0, 2));
    assert.equal(out.toString(), 'AB');
  });

  test('a trailing window reaches the end', async () => {
    const out = await buffer(sliceStream(source(), 8, 2));
    assert.equal(out.toString(), 'IJ');
  });
});

describe('videoHeaders', () => {
  test('200 for full, 206 with Content-Range for partial', () => {
    assert.deepEqual(videoHeaders({ kind: 'full' }, 100, 'video/mp2t').status, 200);
    const partial = videoHeaders({ kind: 'partial', start: 10, end: 19 }, 100, 'video/mp2t');
    assert.equal(partial.status, 206);
    assert.equal(partial.headers['Content-Range'], 'bytes 10-19/100');
    assert.equal(partial.headers['Content-Length'], '10');
    assert.equal(partial.headers['Accept-Ranges'], 'bytes');
  });
});

describe('FullService.videoResponse — streamed 200/206/416 (§5)', () => {
  const bytes = Buffer.from('0123456789');
  const open = (): Promise<VideoOriginal> =>
    Promise.resolve({ stream: Readable.from([bytes]), totalBytes: bytes.length, mime: 'video/mp2t' });

  const readBody = async (body: ReadableStream<Uint8Array> | null): Promise<string> => {
    assert.ok(body !== null);
    return (await buffer(Readable.fromWeb(body as never))).toString();
  };

  test('serves the whole clip as a streamed 200 (never the image LRU)', async () => {
    const service = new FullService({ loadOriginal: () => Promise.resolve(null), openVideoStream: open });
    const res = await service.videoResponse('p1', null);
    assert.ok(res !== null);
    assert.equal(res.status, 200);
    assert.equal(res.headers['Content-Length'], '10');
    assert.equal(await readBody(res.body), '0123456789');
  });

  test('serves a Range as a 206 with the sliced bytes', async () => {
    const service = new FullService({ loadOriginal: () => Promise.resolve(null), openVideoStream: open });
    const res = await service.videoResponse('p1', 'bytes=2-5');
    assert.ok(res !== null);
    assert.equal(res.status, 206);
    assert.equal(res.headers['Content-Range'], 'bytes 2-5/10');
    assert.equal(await readBody(res.body), '2345');
  });

  test('an unsatisfiable range is a 416 with no body', async () => {
    const service = new FullService({ loadOriginal: () => Promise.resolve(null), openVideoStream: open });
    const res = await service.videoResponse('p1', 'bytes=99-200');
    assert.equal(res?.status, 416);
    assert.equal(res?.body, null);
  });

  test('null when there is no video stream provider or the photo is not video', async () => {
    const noProvider = new FullService({ loadOriginal: () => Promise.resolve(null) });
    assert.equal(await noProvider.videoResponse('p1', null), null);
    const notVideo = new FullService({ loadOriginal: () => Promise.resolve(null), openVideoStream: () => Promise.resolve(null) });
    assert.equal(await notVideo.videoResponse('p1', null), null);
  });

  test('the admit gate blocks the stream', async () => {
    const service = new FullService({ loadOriginal: () => Promise.resolve(null), openVideoStream: open, admit: () => false });
    assert.equal(await service.videoResponse('p1', null), null);
  });
});
