import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { AppLockController, AppLockedError } from '../../src/main/crypto/app-lock-controller.js';
import type { AppLockStatus, ConfigureAppLockInput, UnlockResult } from '../../src/main/crypto/app-lock-credentials.js';

class FakeCredentials {
  credentialStatus: AppLockStatus = { state: 'locked', libraryId: 'library-a' };
  unlockResult: UnlockResult = { ok: true, masterKey: Buffer.alloc(32, 7) };
  recoveries = 0;

  status(): AppLockStatus {
    return this.credentialStatus;
  }

  configure(_input: ConfigureAppLockInput): Promise<void> {
    return Promise.resolve();
  }

  unlock(_password: string): Promise<UnlockResult> {
    return Promise.resolve(this.unlockResult);
  }

  changePassword(_current: string, _next: string): Promise<boolean> {
    return Promise.resolve(true);
  }

  recover(_input: ConfigureAppLockInput): Promise<void> {
    this.recoveries += 1;
    return Promise.resolve();
  }

  remove(_password: string): Promise<boolean> {
    return Promise.resolve(true);
  }
}

describe('app-lock authority state machine (#311)', () => {
  test('configured startup stays closed until password custody releases the master', async () => {
    const credentials = new FakeCredentials();
    const opened: Buffer[] = [];
    const controller = new AppLockController({
      credentials,
      openAuthorized: (masterKey) => {
        if (masterKey !== undefined) opened.push(Buffer.from(masterKey));
      },
      closeAuthorized: () => undefined,
    });

    await controller.initialize();
    assert.deepEqual(opened, []);
    assert.throws(() => controller.requireContentAccess(), AppLockedError);
    assert.equal((await controller.unlock('password')).ok, true);
    assert.deepEqual(opened, [Buffer.alloc(32, 7)]);
    assert.equal(controller.snapshot().state, 'unlocked');
    controller.requireContentAccess();
  });

  test('wrong password stays locked and never opens services', async () => {
    const credentials = new FakeCredentials();
    credentials.unlockResult = { ok: false, reason: 'wrong-password' };
    let opened = false;
    const controller = new AppLockController({
      credentials,
      openAuthorized: () => {
        opened = true;
      },
      closeAuthorized: () => undefined,
    });
    assert.deepEqual(await controller.unlock('wrong'), { ok: false, reason: 'wrong-password' });
    assert.equal(opened, false);
    assert.equal(controller.snapshot().state, 'locked');
  });

  test('locking revokes admission before asynchronous cleanup finishes', async () => {
    const credentials = new FakeCredentials();
    let release: (() => void) | undefined;
    const closing = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new AppLockController({
      credentials,
      openAuthorized: () => undefined,
      closeAuthorized: () => closing,
    });
    await controller.unlock('password');

    const transition = controller.lock();
    await Promise.resolve();
    assert.equal(controller.snapshot().state, 'locking');
    assert.throws(() => controller.requireContentAccess(), AppLockedError);
    release?.();
    await transition;
    assert.equal(controller.snapshot().state, 'locked');
  });

  test('cleanup failure invokes fail-closed relaunch hook and remains locked', async () => {
    const credentials = new FakeCredentials();
    let failedClosed = false;
    const controller = new AppLockController({
      credentials,
      openAuthorized: () => undefined,
      closeAuthorized: () => Promise.reject(new Error('busy')),
      failClosed: () => {
        failedClosed = true;
      },
    });
    await controller.unlock('password');
    await controller.lock();
    assert.equal(failedClosed, true);
    assert.equal(controller.snapshot().state, 'locked');
  });

  test('throwing state listeners cannot interrupt custody transitions or other listeners', async () => {
    const credentials = new FakeCredentials();
    const observed: string[] = [];
    let closes = 0;
    const controller = new AppLockController({
      credentials,
      openAuthorized: () => undefined,
      closeAuthorized: () => {
        closes += 1;
      },
    });
    controller.subscribe(() => {
      throw new Error('observer failed');
    });
    controller.subscribe(({ state }) => observed.push(state));

    assert.deepEqual(await controller.unlock('password'), { ok: true });
    await controller.lock();

    assert.equal(closes, 1);
    assert.deepEqual(observed, ['unlocking', 'unlocked', 'locking', 'locked']);
    assert.equal(controller.snapshot().state, 'locked');
  });

  test('throttle reset failure cannot leave an opened library reported as locked', async () => {
    const credentials = new FakeCredentials();
    let opened = false;
    const controller = new AppLockController({
      credentials,
      openAuthorized: () => {
        opened = true;
      },
      closeAuthorized: () => undefined,
      throttle: {
        remainingMs: () => 0,
        recordFailure: () => 0,
        reset: () => {
          throw new Error('persistence unavailable');
        },
      },
    });

    assert.deepEqual(await controller.unlock('password'), { ok: false, reason: 'recovery-required' });
    assert.equal(opened, false);
    assert.equal(controller.snapshot().state, 'locked');
  });

  test('legacy startup opens once and configuration closes into locked state', async () => {
    const credentials = new FakeCredentials();
    credentials.credentialStatus = { state: 'unconfigured' };
    let opens = 0;
    let closes = 0;
    const controller = new AppLockController({
      credentials,
      openAuthorized: () => {
        opens += 1;
      },
      closeAuthorized: () => {
        closes += 1;
      },
    });
    await controller.initialize();
    assert.equal(opens, 1);
    await controller.configure({ libraryId: 'library-a', password: 'Strong Password 1!', masterKey: Buffer.alloc(32, 3) });
    assert.equal(closes, 1);
    assert.equal(controller.snapshot().state, 'locked');
  });

  test('recovery cannot rewrite custody while an authorized library remains open', async () => {
    const credentials = new FakeCredentials();
    const controller = new AppLockController({
      credentials,
      openAuthorized: () => undefined,
      closeAuthorized: () => undefined,
    });
    await controller.unlock('password');

    await assert.rejects(
      controller.recover({ libraryId: 'library-a', password: 'Strong Password 1!', masterKey: Buffer.alloc(32, 3) }),
      AppLockedError,
    );
    assert.equal(credentials.recoveries, 0);
    assert.equal(controller.snapshot().state, 'unlocked');
  });
});
