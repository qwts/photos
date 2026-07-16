import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { drainBeforeDeadline, drainWithCancellationFence } from '../../src/main/crypto/library-shutdown.js';

describe('library shutdown barrier (#311)', () => {
  test('waits for active work before resolving', async () => {
    let release: (() => void) | undefined;
    const active = new Promise<void>((resolve) => {
      release = resolve;
    });
    let drained = false;
    const drain = drainBeforeDeadline([active], 100).then(() => {
      drained = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(drained, false);
    release?.();
    await drain;
    assert.equal(drained, true);
  });

  test('rejects hung work so the controller can relaunch fail-closed', async () => {
    await assert.rejects(drainBeforeDeadline([new Promise(() => undefined)], 5), /did not drain/);
  });

  test('cancels work re-armed by a completion callback during the drain', async () => {
    let release: (() => void) | undefined;
    let scheduled = true;
    let cancellations = 0;
    const active = new Promise<void>((resolve) => {
      release = resolve;
    }).then(() => {
      scheduled = true;
    });
    const draining = drainWithCancellationFence(
      () => {
        cancellations += 1;
        scheduled = false;
      },
      [active],
      100,
    );
    assert.equal(scheduled, false);
    release?.();
    await draining;
    assert.equal(scheduled, false);
    assert.equal(cancellations, 2);
  });
});
