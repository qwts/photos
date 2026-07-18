import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { HEIC_SMOKE_ARGUMENT_PREFIX, HEIC_SMOKE_READY_MARKER, exitForHeicSmokeIfRequested } from '../../src/main/heic-smoke.js';

describe('packaged HEIC preview smoke (#487)', () => {
  test('does not intercept normal launches', async () => {
    const exits: number[] = [];
    assert.equal(await exitForHeicSmokeIfRequested({ exit: (code) => exits.push(code) }, { argv: ['Overlook'] }), false);
    assert.deepEqual(exits, []);
  });

  test('emits dimensions, exits cleanly, and zeroizes all plaintext', async () => {
    const original = Buffer.from('fixture');
    const preview = Buffer.from([0xff, 0xd8, 0xff, 1]);
    const exits: number[] = [];
    let output = '';
    assert.equal(
      await exitForHeicSmokeIfRequested(
        { exit: (code) => exits.push(code) },
        {
          argv: ['Overlook', `${HEIC_SMOKE_ARGUMENT_PREFIX}/tmp/photo.heic`],
          read: () => original,
          decode: () => Promise.resolve({ ok: true, preview: { bytes: preview, width: 3024, height: 4032 } }),
          write: (value) => {
            output += value;
          },
        },
      ),
      true,
    );
    assert.equal(output, `${HEIC_SMOKE_READY_MARKER}:3024x4032\n`);
    assert.deepEqual(exits, [0]);
    assert.deepEqual(original, Buffer.alloc(original.length));
    assert.deepEqual(preview, Buffer.alloc(preview.length));
  });

  test('fails closed when the packaged decoder is unavailable', async () => {
    const exits: number[] = [];
    let output = '';
    await exitForHeicSmokeIfRequested(
      { exit: (code) => exits.push(code) },
      {
        argv: ['Overlook', `${HEIC_SMOKE_ARGUMENT_PREFIX}/tmp/photo.heic`],
        read: () => Buffer.from('fixture'),
        decode: () => Promise.resolve({ ok: false, reason: 'unsupported-codec' }),
        write: (value) => {
          output += value;
        },
      },
    );
    assert.match(output, /decode failed: unsupported-codec/u);
    assert.deepEqual(exits, [1]);
  });
});
