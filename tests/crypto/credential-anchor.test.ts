import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, test } from 'node:test';

import { OsCredentialAnchorStore } from '../../src/main/crypto/credential-anchor.js';

describe('OS credential anchor platform contract (#311)', () => {
  test('unsupported platforms fail closed without a file fallback', () => {
    const store = new OsCredentialAnchorStore({ dataDir: '/profile/library', platform: 'aix' });
    assert.equal(store.isAvailable(), false);
    assert.equal(store.read(), null);
    store.clear();
    assert.throws(() => store.write({ libraryId: 'library-a', generation: 1, recordHash: '0'.repeat(64) }), /credential store refused/);
  });

  test('macOS availability requires the system security tool', () => {
    const store = new OsCredentialAnchorStore({ dataDir: '/profile/library', platform: 'darwin' });
    assert.equal(store.isAvailable(), existsSync('/usr/bin/security'));
  });
});
