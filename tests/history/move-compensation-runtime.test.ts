import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, test } from 'node:test';

import { BlobStore } from '../../src/main/blobs/blob-store.js';
import { createMoveCompensationRuntime, MoveCompensationError } from '../../src/main/history/move-compensation-runtime.js';

async function world() {
  const root = mkdtempSync(join(tmpdir(), 'overlook-move-undo-'));
  const sourceDir = join(root, 'card');
  const store = new BlobStore({ dataDir: join(root, 'library') });
  await store.init();
  const bytes = Buffer.from('verified original bytes');
  const key = { id: 1, key: randomBytes(32) };
  const photoId = 'photo-one';
  const ref = await store.putOriginal(Readable.from([bytes]), key, photoId);
  await mkdir(sourceDir);
  const parent = await stat(sourceDir);
  const sourcePath = join(sourceDir, 'photo.jpg');
  return {
    bytes,
    sourcePath,
    runtime: createMoveCompensationRuntime(store, () => key.key),
    inverse: {
      kind: 'move-compensation' as const,
      photoId,
      contentHash: ref.contentHash,
      sourcePath,
      byteCharge: bytes.length,
      parentIdentity: `${parent.dev}:${parent.ino}`,
    },
  };
}

describe('verified Move compensation (#615, ADR-0025)', () => {
  test('recreates exact bytes without replacement and makes retry idempotent', async () => {
    const state = await world();
    assert.equal(state.runtime.capability(state.inverse), 'ready');
    assert.equal(await state.runtime.restore(state.inverse), 'restored');
    assert.deepEqual(await readFile(state.sourcePath), state.bytes);
    assert.equal(await state.runtime.restore(state.inverse), 'already-restored');
  });

  test('refuses an occupied destination with different bytes', async () => {
    const state = await world();
    await writeFile(state.sourcePath, 'external file');
    assert.equal(state.runtime.capability(state.inverse), 'path-occupied');
    await assert.rejects(
      state.runtime.restore(state.inverse),
      (error: unknown) => error instanceof MoveCompensationError && error.reason === 'path-occupied',
    );
    assert.equal((await readFile(state.sourcePath)).toString(), 'external file');
  });
});
