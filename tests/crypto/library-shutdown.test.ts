import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { drainBeforeDeadline } from '../../src/main/crypto/library-shutdown.js';

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
});
