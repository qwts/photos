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
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Summer_landscape_in_mountains.jpg',
    sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/bd/Summer_landscape_in_mountains.jpg',
    author: 'U.S. Fish and Wildlife Service',
    description: 'Summer mountain landscape',
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
  const response = await fetch(proxyUrl(sourceUrl), { headers: { 'user-agent': 'qwts-photos-fixture-fetch/1.0' } });
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
const realExif = withExif(realPhotos[0], app1);
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
