import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';

import {
  registerHiddenWindowLock,
  type HiddenWindowLockOptions,
  type HiddenWindowLockSource,
} from '../../src/main/crypto/hidden-window-lock.js';

class FakeWindow extends EventEmitter {
  visible = true;
  minimized = false;

  source(): HiddenWindowLockSource {
    return {
      subscribe: (event, listener) => {
        this.on(event, listener);
      },
      unsubscribe: (event, listener) => {
        this.off(event, listener);
      },
      isVisible: () => this.visible,
      isMinimized: () => this.minimized,
    };
  }
}

function deferredScheduler(): {
  readonly schedule: NonNullable<HiddenWindowLockOptions['schedule']>;
  readonly run: () => void;
  readonly pending: () => boolean;
} {
  let callback: (() => void) | undefined;
  return {
    schedule: (next) => {
      callback = next;
      return () => {
        if (callback === next) callback = undefined;
      };
    },
    run: () => {
      const next = callback;
      callback = undefined;
      next?.();
    },
    pending: () => callback !== undefined,
  };
}

function register(source: FakeWindow, lock: () => void, schedule: HiddenWindowLockOptions['schedule']): () => void {
  return registerHiddenWindowLock({
    source: source.source(),
    platform: 'darwin',
    enabled: () => true,
    lock,
    ...(schedule === undefined ? {} : { schedule }),
  });
}

describe('native full-screen hidden-window lock guard (#370)', () => {
  test('ignores transient hide and minimize events while entering and leaving native full screen', () => {
    const source = new FakeWindow();
    const timer = deferredScheduler();
    let locks = 0;
    register(
      source,
      () => {
        locks += 1;
      },
      timer.schedule,
    );

    source.visible = false;
    source.emit('hide');
    source.visible = true;
    source.emit('enter-full-screen');
    source.minimized = true;
    source.emit('minimize');
    source.minimized = false;
    source.emit('leave-full-screen');
    timer.run();

    assert.equal(locks, 0);
  });

  test('locks a real hide or minimize when no full-screen completion follows', () => {
    const source = new FakeWindow();
    const timer = deferredScheduler();
    let locks = 0;
    register(
      source,
      () => {
        locks += 1;
      },
      timer.schedule,
    );

    source.emit('hide');
    timer.run();
    source.emit('minimize');
    timer.run();

    assert.equal(locks, 2);
  });

  test('locks when full-screen completion leaves the window genuinely hidden', () => {
    const source = new FakeWindow();
    const timer = deferredScheduler();
    let locks = 0;
    register(
      source,
      () => {
        locks += 1;
      },
      timer.schedule,
    );

    source.visible = false;
    source.emit('hide');
    source.emit('enter-full-screen');

    assert.equal(locks, 1);
    assert.equal(timer.pending(), false);
  });

  test('non-macOS windows keep the immediate hide/minimize lock path', () => {
    const source = new FakeWindow();
    let locks = 0;
    registerHiddenWindowLock({
      source: source.source(),
      platform: 'win32',
      enabled: () => true,
      lock: () => {
        locks += 1;
      },
    });

    source.emit('hide');
    source.emit('minimize');

    assert.equal(locks, 2);
  });

  test('teardown removes listeners and cancels pending work', () => {
    const source = new FakeWindow();
    const timer = deferredScheduler();
    let locks = 0;
    const stop = register(
      source,
      () => {
        locks += 1;
      },
      timer.schedule,
    );

    source.emit('hide');
    assert.equal(timer.pending(), true);
    stop();
    source.emit('enter-full-screen');
    source.emit('hide');
    timer.run();

    assert.equal(timer.pending(), false);
    assert.equal(locks, 0);
  });
});
