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
});
