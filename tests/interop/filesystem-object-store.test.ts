import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { FilesystemInteropObjectStore } from '../../src/main/interop/filesystem-object-store.js';

test('filesystem interop harness provides bounded provider semantics', async () => {
  const root = mkdtempSync(join(tmpdir(), 'overlook-interop-store-'));
  const store = new FilesystemInteropObjectStore(root);
  assert.equal(await store.authState(), 'connected');

  const firstPath = 'pairings/first/object.bin';
  assert.deepEqual(await store.put(firstPath, Buffer.from('first')), { bytes: 5 });
  assert.equal((await store.get(firstPath)).toString(), 'first');
  assert.deepEqual(await store.verify(firstPath), {
    sha256: 'a7937b64b8caa58f03721bb6bacf5c78cb235ac308b2bf9c4cb314132a6d675a',
    bytes: 5,
  });

  await Promise.all(
    Array.from({ length: 100 }, (_, index) => store.put(`pairings/page/${String(index).padStart(3, '0')}.bin`, Buffer.from([index]))),
  );
  const firstPage = await store.list('pairings', null);
  assert.equal(firstPage.entries.length, 100);
  assert.equal(firstPage.nextCursor, '100');
  const secondPage = await store.list('pairings', firstPage.nextCursor);
  assert.equal(secondPage.entries.length, 1);
  assert.equal(secondPage.nextCursor, null);
  assert.deepEqual(await store.quota(), { usedBytes: 105, totalBytes: null });

  await store.delete(firstPath);
  await store.delete(firstPath);
  await assert.rejects(store.get(firstPath), /not found/u);
  await assert.rejects(store.verify(firstPath), /not found/u);
  await assert.rejects(store.list('pairings', 'invalid'), /cursor/u);
  await assert.rejects(store.put('../outside', Buffer.alloc(0)));
  assert.deepEqual(await new FilesystemInteropObjectStore(join(root, 'missing')).list('pairings', null), {
    entries: [],
    nextCursor: null,
  });
});
