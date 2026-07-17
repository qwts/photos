import assert from 'node:assert/strict';
import test from 'node:test';

import { initialWindowBehavior, resolveE2EWindowMode, shouldShowInitialWindow } from '../../src/main/e2e-window-visibility.js';

test('E2E window mode hides local macOS only', () => {
  assert.equal(resolveE2EWindowMode('darwin', undefined), 'hidden');
  assert.equal(resolveE2EWindowMode('darwin', '1'), 'visible');
  assert.equal(resolveE2EWindowMode('linux', undefined), 'visible');
  assert.equal(resolveE2EWindowMode('win32', undefined), 'visible');
});

test('E2E window visibility is hidden only for an explicit unpackaged harness', () => {
  assert.equal(shouldShowInitialWindow({ packaged: false, harness: '1', mode: 'hidden' }), false);
  assert.equal(shouldShowInitialWindow({ packaged: false, harness: '1', mode: 'visible' }), true);
  assert.equal(shouldShowInitialWindow({ packaged: false, harness: undefined, mode: 'hidden' }), true);
  assert.equal(shouldShowInitialWindow({ packaged: true, harness: '1', mode: 'hidden' }), true);
});

test('hidden E2E windows disable background throttling without changing production', () => {
  assert.deepEqual(initialWindowBehavior({ packaged: false, harness: '1', mode: 'hidden' }), {
    show: false,
    backgroundThrottling: false,
  });
  assert.deepEqual(initialWindowBehavior({ packaged: true, harness: '1', mode: 'hidden' }), {
    show: true,
    backgroundThrottling: true,
  });
});
