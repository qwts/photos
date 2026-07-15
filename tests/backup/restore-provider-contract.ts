import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import type { StorageProvider } from '../../src/main/backup/provider.js';

interface RestoreObject {
  readonly path: string;
  readonly bytes: Buffer;
}

function restoreObjects(): readonly RestoreObject[] {
  return [
    { path: 'recovery/bootstrap.ovrb', bytes: Buffer.from('OVRB-contract-bootstrap') },
    { path: 'manifest/gen-1.ovlk', bytes: Buffer.from('OVLK-contract-manifest') },
    { path: 'blobs/ab/abcdef', bytes: Buffer.from('OVLK-contract-blob') },
  ];
}

/** Provider-neutral disaster-recovery boundary: the unscoped authority can
 * discover a library from its bootstrap, scope to it, and round-trip every
 * object class the restore engine needs. Live adapters reuse this verbatim. */
export async function exerciseRestoreProviderContract(browser: StorageProvider, libraryId: string): Promise<void> {
  const scoped = browser.forLibrary(libraryId);
  const objects = restoreObjects();
  assert.equal(await scoped.authState(), 'connected');
  try {
    for (const object of objects) {
      const put = await scoped.put(object.path, Readable.from([object.bytes]));
      assert.equal(put.bytes, object.bytes.length);
      const verified = await scoped.verify(object.path);
      assert.deepEqual(verified, {
        bytes: object.bytes.length,
        sha256: createHash('sha256').update(object.bytes).digest('hex'),
      });
    }

    assert.ok((await browser.listLibraries()).includes(libraryId), 'bootstrap makes the library discoverable');
    const discovered = browser.forLibrary(libraryId);
    for (const object of objects) {
      assert.deepEqual(await buffer(await discovered.getStream(object.path)), object.bytes);
    }
    assert.deepEqual(await discovered.list('manifest'), [{ path: 'manifest/gen-1.ovlk', bytes: objects[1]?.bytes.length }]);
  } finally {
    const cleanup = await Promise.allSettled([...objects].reverse().map((object) => scoped.delete(object.path)));
    assert.equal(cleanup.filter((result) => result.status === 'rejected').length, 0, 'provider contract removes every scratch object');
  }
}
