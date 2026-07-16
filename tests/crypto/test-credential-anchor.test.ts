import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { TestFileCredentialAnchorStore } from '../../src/main/crypto/test-credential-anchor.js';

describe('unpackaged app-lock anchor seam (#311)', () => {
  test('persists restart state atomically and clears it', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'overlook-test-anchor-')), 'anchor.json');
    const store = new TestFileCredentialAnchorStore(path);
    const anchor = { libraryId: 'library-a', generation: 1, recordHash: 'a'.repeat(64) };
    assert.equal(store.isAvailable(), true);
    assert.equal(store.read(), null);
    store.write(anchor);
    assert.deepEqual(new TestFileCredentialAnchorStore(path).read(), anchor);
    store.clear();
    assert.equal(store.read(), null);
  });

  test('malformed harness files are never accepted as anchors', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'overlook-test-anchor-invalid-')), 'anchor.json');
    const store = new TestFileCredentialAnchorStore(path);
    writeFileSync(path, '{bad json');
    assert.equal(store.read(), null);
    writeFileSync(path, JSON.stringify({ libraryId: 'library-a', generation: 0, recordHash: 'nope' }));
    assert.equal(store.read(), null);
  });
});
