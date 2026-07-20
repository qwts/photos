#!/usr/bin/env node

import { createCipheriv, createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = new Date().toISOString().slice(0, 10);
const CHUNK_BYTES = 4 * 1024 * 1024;
const BENCHMARK_KEY = createHash('sha256').update('Overlook cold-storage benchmark only').digest();

const fixtureGroups = {
  jpeg: [
    'tests/fixtures/photos/flower-landscape.jpg',
    'tests/fixtures/photos/street-city.jpg',
    'tests/fixtures/photos/street-square.jpg',
    'tests/fixtures/photos/summer-landscape.jpg',
    'tests/fixtures/exif/exif-full.jpg',
    'tests/fixtures/exif/exif-stripped.jpg',
  ],
  heic: ['tests/fixtures/heic/iphone-13-pro.heic', 'tests/fixtures/heic/iphone-xr.heic'],
  raw: ['tests/fixtures/exif/sample.raf'],
  sidecar: ['tests/fixtures/photos/manifest.json', 'tests/fixtures/heic/provenance.json'],
};

const corpora = {
  ...fixtureGroups,
  mixed: Object.values(fixtureGroups).flat(),
};

function parseArgs(argv) {
  const outputIndex = argv.indexOf('--output');
  if (outputIndex === -1) return { output: null };
  const output = argv[outputIndex + 1];
  if (output === undefined || output.startsWith('--')) throw new Error('--output requires a path');
  return { output: path.resolve(output) };
}

function commandVersion(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`${command} is required for the cold-storage benchmark`);
  }
  return (
    `${result.stdout}${result.stderr}`
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? command
  );
}

function runTimed(command, args, cwd) {
  const timer = existsSync('/usr/bin/time') ? '/usr/bin/time' : null;
  const started = performance.now();
  const result = spawnSync(timer ?? command, timer === null ? args : ['-lp', command, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const elapsedMs = performance.now() - started;
  if (result.error !== undefined || result.status !== 0) {
    const detail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(`${command} failed${detail === '' ? '' : `: ${detail}`}`);
  }
  const peakMatch = /(?:^|\n)\s*(\d+)\s+maximum resident set size(?:\n|$)/u.exec(result.stderr ?? '');
  return { elapsedMs, peakRssBytes: peakMatch === null ? null : Number(peakMatch[1]) };
}

function combineMetrics(...metrics) {
  const peaks = metrics.map((metric) => metric.peakRssBytes).filter((value) => value !== null);
  return {
    elapsedMs: metrics.reduce((sum, metric) => sum + metric.elapsedMs, 0),
    peakRssBytes: peaks.length === 0 ? null : Math.max(...peaks),
  };
}

function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

/** Production-shaped OVLK v1 envelope. The deterministic benchmark nonce is
 * isolated to temporary fixtures and must never be used for real custody. */
function envelope(plaintext, photoId) {
  const prefix = createHash('sha256').update(photoId).digest().subarray(0, 8);
  const header = Buffer.concat([Buffer.from('OVLK'), Buffer.from([1]), u32(1), prefix]);
  const totalChunks = Math.max(1, Math.ceil(plaintext.length / CHUNK_BYTES));
  const chunks = [header];
  for (let index = 0; index < totalChunks; index += 1) {
    const final = index === totalChunks - 1;
    const flags = final ? 1 : 0;
    const declaredTotal = final ? totalChunks : 0;
    const plainChunk = plaintext.subarray(index * CHUNK_BYTES, Math.min((index + 1) * CHUNK_BYTES, plaintext.length));
    const nonce = Buffer.concat([prefix, u32(index)]);
    const aad = Buffer.concat([Buffer.from(photoId), u32(1), u32(index), Buffer.from([flags]), u32(declaredTotal)]);
    const cipher = createCipheriv('aes-256-gcm', BENCHMARK_KEY, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plainChunk), cipher.final()]);
    chunks.push(Buffer.concat([Buffer.from([flags]), u32(declaredTotal), u32(ciphertext.length), cipher.getAuthTag(), ciphertext]));
  }
  return Buffer.concat(chunks);
}

function safeName(relativePath) {
  return relativePath.replaceAll('/', '__');
}

function stageCorpus(root, files, representation) {
  mkdirSync(root, { recursive: true });
  const staged = [];
  for (const relativePath of files) {
    const source = path.join(ROOT, relativePath);
    const name = `${safeName(relativePath)}${representation === 'ovlk-envelope' ? '.ovlk' : ''}`;
    const destination = path.join(root, name);
    if (representation === 'plaintext') copyFileSync(source, destination);
    else writeFileSync(destination, envelope(readFileSync(source), relativePath));
    staged.push({ name, source: relativePath, bytes: statSync(destination).size });
  }
  return staged;
}

function removeContents(directory) {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
}

function verifyExtracted(directory, staged) {
  for (const file of staged) {
    const actual = readFileSync(path.join(directory, file.name));
    const expected = readFileSync(path.join(directory, '..', 'input', file.name));
    if (!actual.equals(expected)) throw new Error(`extracted bytes differ for ${file.name}`);
  }
}

function zipArchive(work, staged, formatAware) {
  const archive = path.join(work, formatAware ? 'format-aware.zip' : 'deflate.zip');
  const media = staged.filter((file) => !file.name.endsWith('.json'));
  const sidecars = staged.filter((file) => file.name.endsWith('.json'));
  const metrics = [];
  if (formatAware && media.length > 0)
    metrics.push(runTimed('zip', ['-q', '-0', archive, ...media.map((file) => file.name)], path.join(work, 'input')));
  if (formatAware && sidecars.length > 0) {
    metrics.push(runTimed('zip', ['-q', '-9', archive, ...sidecars.map((file) => file.name)], path.join(work, 'input')));
  }
  if (!formatAware) metrics.push(runTimed('zip', ['-q', '-9', archive, ...staged.map((file) => file.name)], path.join(work, 'input')));
  const extracted = path.join(work, 'extracted');
  removeContents(extracted);
  const unpack = runTimed('unzip', ['-q', archive, '-d', extracted], work);
  verifyExtracted(extracted, staged);
  return { archive, pack: combineMetrics(...metrics), unpack };
}

function tarZstdArchive(work, staged) {
  const tarPath = path.join(work, 'corpus.tar');
  const archive = path.join(work, 'corpus.tar.zst');
  const names = staged.map((file) => file.name);
  const tarPack = runTimed('tar', ['-cf', tarPath, ...names], path.join(work, 'input'));
  const zstdPack = runTimed('zstd', ['-q', '-f', '-3', '-T1', tarPath, '-o', archive], work);
  rmSync(tarPath);

  const extracted = path.join(work, 'extracted');
  removeContents(extracted);
  const unpackTar = path.join(work, 'unpacked.tar');
  const zstdUnpack = runTimed('zstd', ['-q', '-f', '-d', archive, '-o', unpackTar], work);
  const tarUnpack = runTimed('tar', ['-xf', unpackTar, '-C', extracted], work);
  rmSync(unpackTar);
  verifyExtracted(extracted, staged);
  return {
    archive,
    pack: combineMetrics(tarPack, zstdPack),
    unpack: combineMetrics(zstdUnpack, tarUnpack),
  };
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function trial(corpus, representation, method, files, root) {
  const work = path.join(root, corpus, representation, method);
  const staged = stageCorpus(path.join(work, 'input'), files, representation);
  mkdirSync(path.join(work, 'extracted'), { recursive: true });
  const inputBytes = staged.reduce((sum, file) => sum + file.bytes, 0);
  const measured = method === 'tar-zstd-3' ? tarZstdArchive(work, staged) : zipArchive(work, staged, method === 'format-aware-zip');
  const archiveBytes = statSync(measured.archive).size;
  return {
    corpus,
    representation,
    method,
    files: staged.length,
    inputBytes,
    archiveBytes,
    savingsPercent: round((1 - archiveBytes / inputBytes) * 100),
    packMs: round(measured.pack.elapsedMs),
    unpackMs: round(measured.unpack.elapsedMs),
    peakRssBytes: measured.pack.peakRssBytes,
  };
}

function main() {
  commandVersion('zip', ['-v']);
  commandVersion('unzip', ['-v']);
  const zstdVersion = commandVersion('zstd', ['--version']);
  const tarVersion = commandVersion('tar', ['--version']);
  const scratch = mkdtempSync(path.join(tmpdir(), 'overlook-cold-storage-'));
  try {
    const trials = [];
    for (const [corpus, files] of Object.entries(corpora)) {
      for (const representation of ['plaintext', 'ovlk-envelope']) {
        for (const method of ['zip-deflate-9', 'tar-zstd-3', 'format-aware-zip']) {
          trials.push(trial(corpus, representation, method, files, scratch));
        }
      }
    }
    const result = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sourceRevision: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(),
      environment: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        zip: commandVersion('zip', ['-v']),
        tar: tarVersion,
        zstd: zstdVersion,
      },
      fixturePolicy: {
        excluded: ['tests/fixtures/exif/corrupt.jpg'],
        note: 'Checked-in licensed fixtures only; exact duplicate copies are excluded because the BlobStore already deduplicates by plaintext SHA-256.',
      },
      corpora,
      trials,
    };
    const json = `${JSON.stringify(result, null, 2)}\n`;
    const { output } = parseArgs(process.argv.slice(2));
    if (output === null) process.stdout.write(json);
    else {
      mkdirSync(path.dirname(output), { recursive: true });
      writeFileSync(output, json);
      process.stdout.write(`Wrote ${path.relative(ROOT, output)} (${String(trials.length)} trials, ${DAY})\n`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main();
