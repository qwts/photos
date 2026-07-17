import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldShowInitialWindow } from '../../src/main/e2e-window-visibility.js';

test('E2E window visibility is hidden only for an explicit unpackaged harness', () => {
  assert.equal(shouldShowInitialWindow({ packaged: false, harness: '1', mode: 'hidden' }), false);
  assert.equal(shouldShowInitialWindow({ packaged: false, harness: '1', mode: 'visible' }), true);
  assert.equal(shouldShowInitialWindow({ packaged: false, harness: undefined, mode: 'hidden' }), true);
  assert.equal(shouldShowInitialWindow({ packaged: true, harness: '1', mode: 'hidden' }), true);
});
