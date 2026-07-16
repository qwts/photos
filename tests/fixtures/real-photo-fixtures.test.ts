import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import sharp from 'sharp';

import { embeddedJpegFromRaf } from '../../src/main/import/raf-preview.js';
import { sampleJpeg } from '../../src/main/library/seed.js';

const ROOT = join(import.meta.dirname, '../../..');
const PHOTO_FIXTURES = join(ROOT, 'tests/fixtures/photos');
const EXIF_FIXTURES = join(ROOT, 'tests/fixtures/exif');
const DESIGN_THUMBS = join(ROOT, 'design/handoff/assets/thumbs');

interface FixtureManifest {
  readonly license: string;
  readonly sources: readonly {
    readonly file: string;
    readonly sourcePage: string;
    readonly author: string;
    readonly sha256: string;
  }[];
}

test('EXIT CRITERIA #127: licensed real-photo fixtures cover varied orientations', async () => {
  const manifestPath = join(PHOTO_FIXTURES, 'manifest.json');
  assert.ok(existsSync(manifestPath), 'real-photo fixture manifest is required');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as FixtureManifest;
  assert.equal(manifest.license, 'CC0-1.0');
  assert.ok(manifest.sources.length >= 4);

  const orientations = new Set<string>();
  for (const source of manifest.sources) {
    assert.match(source.sourcePage, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.ok(source.author.length > 0);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    const metadata = await sharp(join(PHOTO_FIXTURES, source.file)).metadata();
    assert.ok((metadata.width ?? 0) >= 640);
    assert.ok((metadata.height ?? 0) >= 640);
    const ratio = (metadata.width ?? 1) / (metadata.height ?? 1);
    orientations.add(ratio > 1.1 ? 'landscape' : ratio < 0.9 ? 'portrait' : 'square');
  }
  assert.deepEqual(orientations, new Set(['landscape', 'portrait', 'square']));
});

test('EXIT CRITERIA #127: dev seed and import variants decode as real photographs', async () => {
  const seeded = await Promise.all([0, 1, 2, 3].map(async (index) => sharp(sampleJpeg(index)).metadata()));
  assert.ok(seeded.every(({ width, height }) => (width ?? 0) >= 640 && (height ?? 0) >= 640));
  assert.ok(new Set(seeded.map(({ width, height }) => `${String(width)}x${String(height)}`)).size >= 3);

  const stripped = await sharp(join(EXIF_FIXTURES, 'exif-stripped.jpg')).metadata();
  assert.ok((stripped.width ?? 0) >= 640 && (stripped.height ?? 0) >= 640);
  assert.equal(stripped.exif, undefined);

  const embedded = embeddedJpegFromRaf(readFileSync(join(EXIF_FIXTURES, 'sample.raf')));
  assert.ok(embedded, 'RAF fixture must expose an embedded JPEG preview');
  const preview = await sharp(embedded).metadata();
  assert.ok((preview.width ?? 0) >= 640 && (preview.height ?? 0) >= 640);
});

test('EXIT CRITERIA #127: every design handoff thumbnail is a real-photo derivative', async () => {
  const sourcePixels = new Set<string>();
  for (let index = 1; index <= 28; index += 1) {
    const file = join(DESIGN_THUMBS, `t${String(index).padStart(2, '0')}.png`);
    const { data, info } = await sharp(file).resize(8, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    assert.ok(info.width === 8 && info.height === 8);
    sourcePixels.add(data.toString('base64'));
  }
  assert.ok(sourcePixels.size >= 4, 'the handoff needs multiple distinct photographs');
});
