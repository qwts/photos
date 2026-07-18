import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { resolveHeicPreview } from '../../src/main/import/heic-preview.js';
import { decodeHeicWithNative } from '../../src/main/import/heic-preview-native.js';

const fixtures = join(process.cwd(), 'tests', 'fixtures', 'heic');

describe('HEIC preview decode (#487)', () => {
  test('native failure codes remain honest and unknown failures do not masquerade as corruption', async () => {
    const failure = async (code: string) =>
      decodeHeicWithNative(Buffer.from('heic'), undefined, {
        platform: 'darwin',
        loadBinding: () => ({
          decodeHeic: () => Promise.reject(Object.assign(new Error('injected'), { code })),
        }),
      });
    assert.deepEqual(await failure('HEIC_CORRUPT'), { ok: false, reason: 'corrupt' });
    assert.deepEqual(await failure('HEIC_UNSUPPORTED_CODEC'), { ok: false, reason: 'unsupported-codec' });
    assert.deepEqual(await failure('OTHER'), { ok: false, reason: 'decode-failed' });
    assert.deepEqual(await decodeHeicWithNative(Buffer.from('heic'), undefined, { platform: 'win32' }), {
      ok: false,
      reason: 'unsupported-codec',
    });
  });

  test('cancellation drops and zeroizes native output', async () => {
    const controller = new AbortController();
    const decoded = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const result = await resolveHeicPreview(Buffer.from('heic'), {
      signal: controller.signal,
      decode: () => {
        controller.abort();
        return Promise.resolve({ ok: true, preview: { bytes: decoded, width: 1, height: 1 } });
      },
    });
    assert.equal(result, null);
    assert.deepEqual(decoded, Buffer.alloc(decoded.length));
  });

  test('CC0 iPhone XR and iPhone 13 Pro originals decode with orientation applied', { skip: process.platform !== 'darwin' }, async () => {
    const cases = [
      { file: 'iphone-xr.heic', width: 4032, height: 3024 },
      { file: 'iphone-13-pro.heic', width: 3024, height: 4032 },
    ] as const;
    for (const fixture of cases) {
      const original = readFileSync(join(fixtures, fixture.file));
      const result = await resolveHeicPreview(original);
      assert.equal(result?.ok, true, `${fixture.file} decodes through the shipped native bridge`);
      if (result === null || !result.ok) continue;
      assert.equal(result.preview.width, fixture.width);
      assert.equal(result.preview.height, fixture.height);
      assert.deepEqual(result.preview.bytes.subarray(0, 3), Buffer.from([0xff, 0xd8, 0xff]));
      result.preview.bytes.fill(0);
    }
  });
});
