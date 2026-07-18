import assert from 'node:assert/strict';
import test from 'node:test';

import { initialWindowBehavior, resolveE2EWindowMode, shouldShowInitialWindow } from '../../src/main/e2e-window-visibility.js';
import { configurePerfEnvironment } from '../perf/global-setup.js';

test('E2E window mode hides local macOS only', () => {
  assert.equal(resolveE2EWindowMode('darwin', undefined), 'hidden');
  assert.equal(resolveE2EWindowMode('darwin', '1'), 'visible');
  assert.equal(resolveE2EWindowMode('linux', undefined), 'visible');
  assert.equal(resolveE2EWindowMode('win32', undefined), 'visible');
});

test('E2E window visibility is hidden only for an explicit unpackaged harness', () => {
  assert.equal(shouldShowInitialWindow({ packaged: false, harness: '1', mode: 'hidden', noFocus: undefined }), false);
  assert.equal(shouldShowInitialWindow({ packaged: false, harness: '1', mode: 'visible', noFocus: undefined }), true);
  assert.equal(shouldShowInitialWindow({ packaged: false, harness: undefined, mode: 'hidden', noFocus: undefined }), true);
  assert.equal(shouldShowInitialWindow({ packaged: true, harness: '1', mode: 'hidden', noFocus: undefined }), true);
});

test('hidden E2E windows disable background throttling without changing production', () => {
  assert.deepEqual(initialWindowBehavior({ packaged: false, harness: '1', mode: 'hidden', noFocus: undefined }), {
    show: false,
    backgroundThrottling: false,
    showInactiveWhenReady: false,
  });
  assert.deepEqual(initialWindowBehavior({ packaged: true, harness: '1', mode: 'hidden', noFocus: undefined }), {
    show: true,
    backgroundThrottling: true,
    showInactiveWhenReady: false,
  });
});

test('OVERLOOK_NO_FOCUS defers a visible window to showInactive without stealing focus', () => {
  // Visible window (dev, perf, packaged) + noFocus: start hidden, then showInactive.
  assert.deepEqual(initialWindowBehavior({ packaged: false, harness: undefined, mode: undefined, noFocus: '1' }), {
    show: false,
    backgroundThrottling: false,
    showInactiveWhenReady: true,
  });
  assert.deepEqual(initialWindowBehavior({ packaged: true, harness: '1', mode: 'hidden', noFocus: '1' }), {
    show: false,
    backgroundThrottling: false,
    showInactiveWhenReady: true,
  });
  // A window the harness hides entirely never shows inactive.
  assert.deepEqual(initialWindowBehavior({ packaged: false, harness: '1', mode: 'hidden', noFocus: '1' }), {
    show: false,
    backgroundThrottling: false,
    showInactiveWhenReady: false,
  });
  // Explicit opt-out restores the focused launch.
  assert.deepEqual(initialWindowBehavior({ packaged: false, harness: undefined, mode: undefined, noFocus: '0' }), {
    show: true,
    backgroundThrottling: true,
    showInactiveWhenReady: false,
  });
});

test('the performance lane explicitly measures a visible window', () => {
  const previousVisible = process.env['OVERLOOK_E2E_VISIBLE'];
  const previousNoFocus = process.env['OVERLOOK_NO_FOCUS'];
  delete process.env['OVERLOOK_E2E_VISIBLE'];
  delete process.env['OVERLOOK_NO_FOCUS'];
  try {
    configurePerfEnvironment();
    assert.equal(process.env['OVERLOOK_E2E_VISIBLE'], '1');
    assert.equal(resolveE2EWindowMode('darwin', process.env['OVERLOOK_E2E_VISIBLE']), 'visible');
    // The visible perf window opens inactive so long runs never steal focus.
    assert.equal(process.env['OVERLOOK_NO_FOCUS'], '1');
  } finally {
    if (previousVisible === undefined) delete process.env['OVERLOOK_E2E_VISIBLE'];
    else process.env['OVERLOOK_E2E_VISIBLE'] = previousVisible;
    if (previousNoFocus === undefined) delete process.env['OVERLOOK_NO_FOCUS'];
    else process.env['OVERLOOK_NO_FOCUS'] = previousNoFocus;
  }
});

test('the performance lane honors an explicit focused-window override', () => {
  const previousNoFocus = process.env['OVERLOOK_NO_FOCUS'];
  process.env['OVERLOOK_NO_FOCUS'] = '0';
  try {
    configurePerfEnvironment();
    assert.equal(process.env['OVERLOOK_NO_FOCUS'], '0');
  } finally {
    if (previousNoFocus === undefined) delete process.env['OVERLOOK_NO_FOCUS'];
    else process.env['OVERLOOK_NO_FOCUS'] = previousNoFocus;
  }
});
