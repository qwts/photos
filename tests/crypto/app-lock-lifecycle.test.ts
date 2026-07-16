import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';

import { idleLimitSeconds } from '../../src/main/crypto/app-lock-policy.js';
import { registerLastWindowLock } from '../../src/main/crypto/last-window-lock.js';

describe('app-lock lifecycle policy (#311)', () => {
  test('idle choices map to the ADR-0013 limits and Never stays explicit', () => {
    assert.equal(idleLimitSeconds('1'), 60);
    assert.equal(idleLimitSeconds('5'), 300);
    assert.equal(idleLimitSeconds('15'), 900);
    assert.equal(idleLimitSeconds('30'), 1_800);
    assert.equal(idleLimitSeconds('never'), null);
  });

  test('last-window close locks only enabled macOS apps and unsubscribes cleanly', () => {
    const source = new EventEmitter();
    let enabled = true;
    let locks = 0;
    const offMac = registerLastWindowLock(
      source,
      'darwin',
      () => enabled,
      () => {
        locks += 1;
      },
    );
    const offLinux = registerLastWindowLock(
      source,
      'linux',
      () => true,
      () => {
        locks += 100;
      },
    );

    source.emit('window-all-closed');
    assert.equal(locks, 1);
    enabled = false;
    source.emit('window-all-closed');
    assert.equal(locks, 1);
    offMac();
    offLinux();
    enabled = true;
    source.emit('window-all-closed');
    assert.equal(locks, 1);
  });
});
