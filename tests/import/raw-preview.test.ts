import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveRawPreview } from '../../src/main/import/raw-preview.js';
import { sampleJpeg } from '../../src/main/library/seed.js';

const RAW_EXTENSIONS = ['raf', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2'] as const;

function genericRawContainer(jpeg: Buffer): Buffer {
  return Buffer.concat([Buffer.alloc(257, 0x35), jpeg, Buffer.alloc(113, 0x79)]);
}

describe('RAW preview adapter (#368)', () => {
  test('allowlist matrix resolves a valid embedded JPEG by content, not extension', async () => {
    const jpeg = sampleJpeg(4);
    for (const extension of RAW_EXTENSIONS) {
      const preview = await resolveRawPreview(genericRawContainer(jpeg));
      assert.ok(preview, `${extension} must resolve its embedded JPEG`);
      assert.deepEqual(preview.bytes, jpeg);
      assert.equal(preview.source, 'embedded');
      assert.ok(preview.width > 0);
      assert.ok(preview.height > 0);
    }
  });

  test('corrupt and preview-less RAW bytes fail explicitly', async () => {
    assert.equal(await resolveRawPreview(Buffer.alloc(512, 0x42)), null);
  });

  test('preview-less RAW falls back to the decoder and owns its result', async () => {
    const jpeg = sampleJpeg(7);
    const decoderOutput = Buffer.from(jpeg);
    let calls = 0;
    const preview = await resolveRawPreview(Buffer.alloc(512, 0x42), {
      decode: () => {
        calls += 1;
        return Promise.resolve(decoderOutput);
      },
    });
    assert.equal(calls, 1);
    assert.equal(preview?.source, 'decoded');
    assert.deepEqual(preview?.bytes, jpeg);
    assert.deepEqual(decoderOutput, Buffer.alloc(decoderOutput.length), 'decoder allocation is zeroized after the owned copy');
  });

  test('cancellation drops and zeroizes an in-flight decoder result', async () => {
    const controller = new AbortController();
    const decoderOutput = Buffer.from(sampleJpeg(8));
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = resolveRawPreview(Buffer.alloc(512, 0x42), {
      signal: controller.signal,
      decode: async () => {
        started?.();
        await gate;
        return decoderOutput;
      },
    });
    await entered;
    controller.abort();
    release?.();
    assert.equal(await pending, null);
    assert.deepEqual(decoderOutput, Buffer.alloc(decoderOutput.length));
  });

  test('a corrupt JPEG candidate cannot hide a later trustworthy preview', async () => {
    const valid = sampleJpeg(9);
    const corrupt = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);
    const preview = await resolveRawPreview(Buffer.concat([corrupt, Buffer.alloc(11), valid]));
    assert.deepEqual(preview?.bytes, valid);
  });
});
