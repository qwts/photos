import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { providerDescriptorSchema } from '../../shared/backup/provider-descriptor.js';
import { ProviderError, type StorageProvider } from './provider.js';

const PAYLOAD = Buffer.from('OVLK-object-provider-contract');

/** Provider-neutral encrypted-object contract shared by deterministic and signed-live adapters. */
export async function exerciseObjectProviderContract(browser: StorageProvider, libraryId: string): Promise<void> {
  const provider = browser.forLibrary(libraryId);
  const path = 'blobs/ab/abcdef';
  const bootstrap = 'recovery/bootstrap.ovrb';
  assert.equal(
    providerDescriptorSchema.safeParse({
      id: provider.id,
      label: provider.label,
      capabilities: provider.capabilities,
      available: true,
      unavailableReason: null,
    }).success,
    true,
  );
  try {
    assert.deepEqual(await provider.put(path, Readable.from([PAYLOAD])), { bytes: PAYLOAD.length });
    assert.deepEqual(await browser.listLibraries(), []);
    await provider.put(bootstrap, Readable.from([PAYLOAD]));
    assert.ok((await browser.listLibraries()).includes(libraryId));
    assert.deepEqual(await provider.list('blobs'), [{ path, bytes: PAYLOAD.length }]);
    assert.deepEqual(await buffer(await provider.getStream(path)), PAYLOAD);
    assert.deepEqual(await provider.verify(path), {
      sha256: createHash('sha256').update(PAYLOAD).digest('hex'),
      bytes: PAYLOAD.length,
    });
  } finally {
    await provider.delete(path);
    await provider.delete(bootstrap);
  }
  assert.deepEqual(await provider.list('blobs'), []);
  await assert.rejects(provider.getStream(path), (error: unknown) => error instanceof ProviderError && error.kind === 'not-found');
}
