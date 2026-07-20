import assert from 'node:assert/strict';
import test from 'node:test';

import {
  initialWindowBehavior,
  requestNativeWindowAttention,
  resolveE2EWindowMode,
  shouldShowInitialWindow,
} from '../../src/main/e2e-window-visibility.js';
import { configurePerfEnvironment } from '../perf/global-setup.js';

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

test('hidden E2E windows reject native attention without suppressing visible modes', () => {
  const calls: string[] = [];
  const target = {
    isMinimized: () => true,
    restore: () => calls.push('restore'),
    isVisible: () => false,
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  };

  requestNativeWindowAttention(target, { packaged: false, harness: '1', mode: 'hidden' });
  assert.deepEqual(calls, []);

  requestNativeWindowAttention(target, { packaged: false, harness: '1', mode: 'visible' });
  assert.deepEqual(calls, ['restore', 'show', 'focus']);
});

test('packaged and ordinary app windows always accept native attention', () => {
  for (const input of [
    { packaged: true, harness: '1', mode: 'hidden' },
    { packaged: false, harness: undefined, mode: 'hidden' },
  ]) {
    let focused = false;
    requestNativeWindowAttention(
      {
        isMinimized: () => false,
        restore: () => assert.fail('a restored window was not minimized'),
        isVisible: () => true,
        show: () => assert.fail('a visible window was shown again'),
        focus: () => {
          focused = true;
        },
      },
      input,
    );
    assert.equal(focused, true);
  }
});

test('the performance lane explicitly measures a visible window', () => {
  const previous = process.env['OVERLOOK_E2E_VISIBLE'];
  delete process.env['OVERLOOK_E2E_VISIBLE'];
  try {
    configurePerfEnvironment();
    assert.equal(process.env['OVERLOOK_E2E_VISIBLE'], '1');
    assert.equal(resolveE2EWindowMode('darwin', process.env['OVERLOOK_E2E_VISIBLE']), 'visible');
  } finally {
    if (previous === undefined) delete process.env['OVERLOOK_E2E_VISIBLE'];
    else process.env['OVERLOOK_E2E_VISIBLE'] = previous;
  }
});
