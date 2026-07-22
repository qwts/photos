import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import sharp from 'sharp';

const root = process.cwd();
const fixtureDir = join(root, 'tests/fixtures/photos');
const exifDir = join(root, 'tests/fixtures/exif');
const thumbDir = join(root, 'design/handoff/assets/thumbs');

const sources = [
  {
    file: 'summer-landscape.jpg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Mountain_and_Landscape.jpg',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/9/94/Mountain_and_Landscape.jpg',
    author: 'Unknown author (PikWizard source)',
    description: 'Mountain landscape',
    resize: { width: 1280 },
  },
  {
    file: 'street-city.jpg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Street_city.jpg',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/0/01/Street_city.jpg',
    author: 'Omina006',
    description: 'Portrait-oriented city street',
    resize: { width: 960 },
  },
  {
    file: 'flower-landscape.jpg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Flower_photography_image.jpg',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/30/Flower_photography_image.jpg',
    author: 'Gopinath KARUMALAI',
    description: 'Flowers at dusk',
    resize: { width: 1280 },
  },
  {
    file: 'street-square.jpg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Street_photography.jpeg',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Street_photography.jpeg',
    author: 'Kumar Mangal Roy',
    description: 'Street vendor in Sonarpur, Kolkata',
    resize: { width: 960, height: 960 },
  },
];

const thumbSizes = [
  [420, 280],
  [280, 420],
  [420, 315],
  [315, 420],
  [420, 236],
  [420, 420],
  [420, 280],
  [420, 315],
  [420, 280],
  [280, 420],
  [420, 315],
  [315, 420],
  [420, 236],
  [420, 420],
  [420, 280],
  [420, 315],
  [420, 280],
  [280, 420],
  [420, 315],
  [315, 420],
  [420, 236],
  [420, 420],
  [420, 280],
  [420, 315],
  [420, 280],
  [280, 420],
  [420, 315],
  [315, 420],
];

function proxyUrl(sourceUrl) {
  return `https://images.weserv.nl/?url=${encodeURIComponent(sourceUrl)}&output=jpg&q=88`;
}

async function download(sourceUrl) {
  const response = await fetch(proxyUrl(sourceUrl), { headers: { 'user-agent': 'qwts-overlook-fixture-fetch/1.0' } });
  if (!response.ok) throw new Error(`fixture download failed: ${String(response.status)} ${sourceUrl}`);
  return Buffer.from(await response.arrayBuffer());
}

function exifSegment(jpeg) {
  for (let offset = 2; offset + 4 <= jpeg.length;) {
    if (jpeg[offset] !== 0xff) break;
    const marker = jpeg[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = jpeg.readUInt16BE(offset + 2);
    const end = offset + length + 2;
    if (marker === 0xe1 && jpeg.toString('ascii', offset + 4, offset + 10) === 'Exif\0\0') return jpeg.subarray(offset, end);
    offset = end;
  }
  throw new Error('EXIF template has no APP1 Exif segment');
}

function withExif(jpeg, segment) {
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

function withExifDimensions(segment, width, height) {
  const patched = Buffer.from(segment);
  const tiff = 10;
  const littleEndian = patched.toString('ascii', tiff, tiff + 2) === 'II';
  const read16 = (offset) => (littleEndian ? patched.readUInt16LE(offset) : patched.readUInt16BE(offset));
  const read32 = (offset) => (littleEndian ? patched.readUInt32LE(offset) : patched.readUInt32BE(offset));
  const write16 = (value, offset) => (littleEndian ? patched.writeUInt16LE(value, offset) : patched.writeUInt16BE(value, offset));
  const write32 = (value, offset) => (littleEndian ? patched.writeUInt32LE(value, offset) : patched.writeUInt32BE(value, offset));
  const entries = (relativeOffset) => {
    const start = tiff + relativeOffset;
    const count = read16(start);
    return Array.from({ length: count }, (_, index) => start + 2 + index * 12);
  };
  const ifd0 = read32(tiff + 4);
  const exifPointer = entries(ifd0).find((entry) => read16(entry) === 0x8769);
  if (exifPointer === undefined) throw new Error('EXIF template has no Exif IFD pointer');
  const exifEntries = entries(read32(exifPointer + 8));
  const patchDimension = (tag, value) => {
    const entry = exifEntries.find((candidate) => read16(candidate) === tag);
    if (entry === undefined) throw new Error(`EXIF template has no dimension tag ${String(tag)}`);
    const type = read16(entry + 2);
    const count = read32(entry + 4);
    if (count !== 1 || (type !== 3 && type !== 4)) throw new Error(`unsupported EXIF dimension encoding for ${String(tag)}`);
    if (type === 3) write16(value, entry + 8);
    else write32(value, entry + 8);
  };
  patchDimension(0xa002, width);
  patchDimension(0xa003, height);
  return patched;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

await mkdir(fixtureDir, { recursive: true });
const exifTemplate = await readFile(join(exifDir, 'exif-full.jpg'));
const rafTemplate = await readFile(join(exifDir, 'sample.raf'));
const app1 = exifSegment(exifTemplate);
const generated = [];

for (const source of sources) {
  const downloaded = await download(source.sourceUrl);
  let pipeline = sharp(downloaded).rotate();
  pipeline = source.resize.height
    ? pipeline.resize(source.resize.width, source.resize.height, { fit: 'cover', position: 'attention' })
    : pipeline.resize(source.resize.width, undefined, { withoutEnlargement: true });
  const bytes = await pipeline.jpeg({ quality: 84, chromaSubsampling: '4:2:0' }).toBuffer();
  await writeFile(join(fixtureDir, source.file), bytes);
  generated.push({
    file: source.file,
    sourcePage: source.sourcePage,
    sourceUrl: source.sourceUrl,
    author: source.author,
    description: source.description,
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    transformation: source.resize.height ? 'cropped and resized to 960x960 JPEG' : `resized to ${String(source.resize.width)}px wide JPEG`,
    sha256: sha256(bytes),
  });
}

const realPhotos = await Promise.all(sources.map(({ file }) => readFile(join(fixtureDir, file))));
const realExifMetadata = await sharp(realPhotos[0]).metadata();
if (realExifMetadata.width === undefined || realExifMetadata.height === undefined)
  throw new Error('real EXIF fixture dimensions are unavailable');
const realExif = withExif(realPhotos[0], withExifDimensions(app1, realExifMetadata.width, realExifMetadata.height));
await writeFile(join(exifDir, 'exif-full.jpg'), realExif);
await writeFile(join(exifDir, 'exif-stripped.jpg'), await sharp(realPhotos[1]).jpeg({ quality: 84 }).toBuffer());

const previewOffset = rafTemplate.readUInt32BE(84);
const rafHeader = Buffer.from(rafTemplate.subarray(0, previewOffset));
rafHeader.writeUInt32BE(realExif.length, 88);
await writeFile(join(exifDir, 'sample.raf'), Buffer.concat([rafHeader, realExif]));

const designThumbs = [];
for (let index = 0; index < thumbSizes.length; index += 1) {
  const size = thumbSizes[index];
  const source = realPhotos[index % realPhotos.length];
  const file = `t${String(index + 1).padStart(2, '0')}.png`;
  await sharp(source)
    .resize(size[0], size[1], { fit: 'cover', position: index % 2 === 0 ? 'attention' : 'centre' })
    .png({ compressionLevel: 9, palette: true, colours: 256 })
    .toFile(join(thumbDir, file));
  designThumbs.push({
    file,
    source: sources[index % sources.length].file,
    width: size[0],
    height: size[1],
    sha256: sha256(await readFile(join(thumbDir, file))),
  });
}

await writeFile(
  join(fixtureDir, 'manifest.json'),
  `${JSON.stringify({ license: 'CC0-1.0', retrieved: '2026-07-15', sources: generated, designThumbs }, null, 2)}\n`,
);
