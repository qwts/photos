// Deterministic GIF/WebP fixture generator (#547, ADR-0026 test notes).
// Run from the repo root:  node tests/fixtures/animated/generate-fixtures.mjs
// Regenerates the checked-in fixtures byte-identically (no timestamps, no
// randomness) and prints their SHA-256 digests for provenance.json.

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const OUT = dirname(fileURLToPath(import.meta.url));

/** Minimal GIF89a writer using the classic "uncompressed LZW" trick: a clear
 * code before every pixel keeps the dictionary at its initial size, so each
 * code stays at minCodeSize+1 bits — tiny frames, standard decoders. */
function gif(width, height, frames, { loopCount } = {}) {
  const bytes = [];
  const push = (...values) => bytes.push(...values);
  const pushU16 = (value) => push(value & 0xff, (value >> 8) & 0xff);
  // Header + logical screen descriptor with a 4-color global table.
  push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // GIF89a
  pushU16(width);
  pushU16(height);
  push(0x91, 0, 0); // GCT present, 4 entries; background 0; no aspect
  push(0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0xff); // black, red, green, blue
  if (loopCount !== undefined) {
    push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1);
    pushU16(loopCount);
    push(0);
  }
  for (const colorIndex of frames) {
    push(0x21, 0xf9, 4, 0x04, 0x0a, 0x00, 0x00, 0x00); // GCE: 100ms, no transparency
    push(0x2c); // image descriptor at 0,0 full size, no local table
    pushU16(0);
    pushU16(0);
    pushU16(width);
    pushU16(height);
    push(0x00);
    push(2); // LZW minimum code size (4-color table)
    // Code stream: [clear, pixel] * n + EOI, 3-bit codes, LSB-first packing.
    const codes = [];
    for (let i = 0; i < width * height; i += 1) codes.push(4, colorIndex); // 4 = clear
    codes.push(4, 5); // final clear + end-of-information
    let acc = 0;
    let accBits = 0;
    const data = [];
    for (const code of codes) {
      acc |= code << accBits;
      accBits += 3;
      while (accBits >= 8) {
        data.push(acc & 0xff);
        acc >>= 8;
        accBits -= 8;
      }
    }
    if (accBits > 0) data.push(acc & 0xff);
    for (let offset = 0; offset < data.length; offset += 255) {
      const block = data.slice(offset, offset + 255);
      push(block.length, ...block);
    }
    push(0); // block terminator
  }
  push(0x3b); // trailer
  return Buffer.from(bytes);
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const animatedGif = gif(8, 8, [1, 2, 3], { loopCount: 0 });
// Sharp re-encodes the animated GIF into an animated WebP deterministically.
const animatedWebp = await sharp(animatedGif, { animated: true }).webp({ quality: 80, effort: 4 }).toBuffer();
const staticWebp = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 128, b: 255 } } })
  .webp({ quality: 80, effort: 4, lossless: true })
  .toBuffer();

for (const [file, buffer] of [
  ['animated.gif', animatedGif],
  ['animated.webp', animatedWebp],
  ['static.webp', staticWebp],
]) {
  await writeFile(join(OUT, file), buffer);
  const meta = await sharp(buffer, { animated: true }).metadata();
  console.log(`${file}\t${String(buffer.length)}B\tpages=${String(meta.pages ?? 1)}\tloop=${String(meta.loop ?? '-')}\t${sha256(buffer)}`);
}
