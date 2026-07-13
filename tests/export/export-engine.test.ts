import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { access, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { BlobStore } from '../../src/main/blobs/blob-store.js';
import { ExportEngine, ExportPreflightError, type ExportEngineDeps } from '../../src/main/export/export-engine.js';
import { sampleJpeg } from '../../src/main/library/seed.js';
import type { EnvelopeKey } from '../../src/main/crypto/envelope.js';
import type { PhotoRecord } from '../../src/shared/library/types.js';

// #97 exit criteria against real components: seeded photos through the real
// encrypted store → byte-identical files on disk, ordered progress,
// cancellation keeping completed files only.

async function seededWorld(count: number) {
  const dataDir = mkdtempSync(join(tmpdir(), 'overlook-export-'));
  const store = new BlobStore({ dataDir });
  await store.init();
  const key: EnvelopeKey = { id: 1, key: randomBytes(32) };
  const rows = new Map<string, PhotoRecord>();
  const bytesById = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    const bytes = sampleJpeg(index);
    const id = `PHOTO${String(index)}`;
    const ref = await store.putOriginal(Readable.from([bytes]), key, id);
    rows.set(id, {
      id,
      fileName: `IMG_${String(4021 + index)}.JPG`,
      contentHash: ref.contentHash,
      bytes: bytes.length,
      keyId: 1,
    } as PhotoRecord);
    bytesById.set(id, bytes);
  }
  const destination = mkdtempSync(join(tmpdir(), 'overlook-export-dest-'));
  const progress: [number, number][] = [];
  const deps: ExportEngineDeps = {
    repo: { get: (id) => rows.get(id) },
    blobs: store,
    resolveKey: () => key.key,
    writeFile: async (filePath, plaintext) => pipeline(plaintext, createWriteStream(filePath, { flags: 'wx' })),
    exists: async (filePath) =>
      access(filePath).then(
        () => true,
        () => false,
      ),
    freeBytes: async (dir) => {
      const stats = await statfs(dir);
      return stats.bavail * stats.bsize;
    },
    joinPath: (dir, name) => join(dir, name),
    events: {
      progress: (done, total) => progress.push([done, total]),
    },
  };
  return { deps, destination, rows, bytesById, progress, engine: new ExportEngine(deps) };
}

describe('export engine (#97)', () => {
  test('EXIT CRITERIA: N seeded photos → N byte-identical files; progress ordered', async () => {
    const world = await seededWorld(4);
    const summary = await world.engine.exportPhotos([...world.rows.keys()], world.destination);
    assert.deepEqual(
      { exported: summary.exported, failed: summary.failed, cancelled: summary.cancelled },
      { exported: 4, failed: 0, cancelled: 0 },
    );
    for (const [id, row] of world.rows) {
      const onDisk = readFileSync(join(world.destination, row.fileName));
      assert.deepEqual(onDisk, world.bytesById.get(id), `${row.fileName} byte-identical to source`);
    }
    assert.deepEqual(
      world.progress,
      [
        [1, 4],
        [2, 4],
        [3, 4],
        [4, 4],
      ],
      'progress stream is ordered n/total',
    );
  });

  test('collisions get a recorded numbered suffix — existing files never clobbered', async () => {
    const world = await seededWorld(1);
    const row = [...world.rows.values()][0];
    writeFileSync(join(world.destination, row?.fileName ?? ''), Buffer.from('already here'));
    const summary = await world.engine.exportPhotos([...world.rows.keys()], world.destination);
    assert.equal(summary.exported, 1);
    assert.equal(summary.files[0]?.renamed, true);
    assert.equal(summary.files[0]?.fileName, 'IMG_4021 (1).JPG');
    assert.equal(readFileSync(join(world.destination, row?.fileName ?? '')).toString(), 'already here');
  });

  test('EXIT CRITERIA: cancellation finishes the current file and keeps completed only', async () => {
    const world = await seededWorld(4);
    const controller = new AbortController();
    const deps: ExportEngineDeps = {
      ...world.deps,
      events: {
        progress: (done, total) => {
          world.progress.push([done, total]);
          if (done === 2) {
            controller.abort(); // Cancel clicked mid-batch
          }
        },
      },
    };
    const summary = await new ExportEngine(deps).exportPhotos([...world.rows.keys()], world.destination, controller.signal);
    assert.deepEqual({ exported: summary.exported, cancelled: summary.cancelled }, { exported: 2, cancelled: 2 });
    assert.equal(readdirSync(world.destination).length, 2, 'completed files only — no partials');
  });

  test('free-space preflight fails BEFORE any bytes move', async () => {
    const world = await seededWorld(2);
    const deps: ExportEngineDeps = { ...world.deps, freeBytes: async () => Promise.resolve(10) };
    await assert.rejects(new ExportEngine(deps).exportPhotos([...world.rows.keys()], world.destination), ExportPreflightError);
    assert.equal(readdirSync(world.destination).length, 0);
  });

  test('a missing photo fails that entry; the batch continues', async () => {
    const world = await seededWorld(1);
    const summary = await world.engine.exportPhotos(['GHOST', ...world.rows.keys()], world.destination);
    assert.deepEqual({ exported: summary.exported, failed: summary.failed }, { exported: 1, failed: 1 });
  });
});
