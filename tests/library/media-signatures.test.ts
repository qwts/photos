import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';

import { probeMediaInfo, sniffImageKind } from '../../src/shared/library/media-signatures.js';
import { classifyMediaFile } from '../../src/shared/library/media-files.js';
import { parseMediaInfo } from '../../src/shared/library/media-info.js';

const FIXTURES = join(import.meta.dirname, '../../../tests/fixtures/animated');

const animatedGif = readFileSync(join(FIXTURES, 'animated.gif'));
const animatedWebp = readFileSync(join(FIXTURES, 'animated.webp'));
const staticWebp = readFileSync(join(FIXTURES, 'static.webp'));
const jpeg = readFileSync(join(import.meta.dirname, '../../../tests/fixtures/exif/exif-full.jpg'));

describe('sniffImageKind (ADR-0026 §2)', () => {
  test('recognizes supported image signatures', () => {
    assert.equal(sniffImageKind(animatedGif), 'gif');
    assert.equal(sniffImageKind(animatedWebp), 'webp');
    assert.equal(sniffImageKind(staticWebp), 'webp');
    assert.equal(sniffImageKind(jpeg), 'jpeg');
    assert.equal(sniffImageKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])), 'png');
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(16)]);
    assert.equal(sniffImageKind(heic), 'heic');
  });

  test('returns null for unknown, empty, and truncated-before-magic input', () => {
    assert.equal(sniffImageKind(Buffer.alloc(0)), null);
    assert.equal(sniffImageKind(Buffer.from('GIF8')), null); // cut inside the magic
    assert.equal(sniffImageKind(Buffer.from('RIFFxxxxWAVE')), null); // RIFF but not WebP
    assert.equal(sniffImageKind(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42')])), null); // BMFF, not HEIC
    assert.equal(sniffImageKind(Buffer.from('not media at all')), null);
  });
});

describe('probeMediaInfo (ADR-0026 §2/§9)', () => {
  test('reads GIF frame count and infinite loop', () => {
    assert.deepEqual(probeMediaInfo(animatedGif, 'gif'), { animated: true, frameCount: 3, loopCount: 0 });
  });

  test('reads animated WebP frames and loop', () => {
    assert.deepEqual(probeMediaInfo(animatedWebp, 'webp'), { animated: true, frameCount: 3, loopCount: 0 });
  });

  test('classifies static WebP as single-frame, not animated', () => {
    assert.deepEqual(probeMediaInfo(staticWebp, 'webp'), { animated: false, frameCount: 1, loopCount: null });
  });

  test('classifies a sharp-generated single-frame GIF as not animated', async () => {
    const singleFrame = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 10, b: 10 } } })
      .gif()
      .toBuffer();
    const info = probeMediaInfo(singleFrame, 'gif');
    assert.equal(info?.animated, false);
    assert.equal(info?.frameCount, 1);
  });

  test('truncated input degrades fields to null instead of guessing', () => {
    const cutGif = probeMediaInfo(animatedGif.subarray(0, 40), 'gif');
    assert.equal(cutGif?.frameCount, null);
    const cutWebp = probeMediaInfo(animatedWebp.subarray(0, 32), 'webp');
    assert.equal(cutWebp?.frameCount, null);
  });

  test('returns null when bytes do not match the claimed kind (spoofed suffix)', () => {
    assert.equal(probeMediaInfo(jpeg, 'gif'), null);
    assert.equal(probeMediaInfo(animatedGif, 'webp'), null);
    assert.equal(probeMediaInfo(jpeg, 'jpeg'), null); // kinds without animation semantics
  });

  test('hostile garbage after a valid header never throws', () => {
    const garbage = Buffer.concat([Buffer.from('GIF89a'), Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 37) % 256))]);
    const info = probeMediaInfo(garbage, 'gif');
    assert.notEqual(info, null);
  });
});

describe('media-info column parsing', () => {
  test('roundtrips valid JSON and rejects corrupt values as null', () => {
    assert.deepEqual(parseMediaInfo('{"animated":true,"frameCount":3,"loopCount":0}'), {
      animated: true,
      frameCount: 3,
      loopCount: 0,
    });
    assert.equal(parseMediaInfo(null), null);
    assert.equal(parseMediaInfo('not json'), null);
    assert.equal(parseMediaInfo('{"animated":"yes"}'), null);
  });
});

describe('extension classification for the new kinds', () => {
  test('gif and webp are import candidates', () => {
    assert.equal(classifyMediaFile('party.GIF'), 'gif');
    assert.equal(classifyMediaFile('sticker.webp'), 'webp');
  });
});

describe('fixtures decode with sharp (poster path preflight)', () => {
  test('each fixture decodes and reports 8x8', async () => {
    for (const bytes of [animatedGif, animatedWebp, staticWebp]) {
      const meta = await sharp(bytes, { failOn: 'error' }).metadata();
      assert.equal(meta.width, 8);
      assert.equal(meta.height, 8);
    }
  });
});
