import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { RELEASE_SMOKE_ARGUMENT, RELEASE_SMOKE_READY_MARKER, exitForReleaseSmokeIfRequested } from '../../src/main/release-smoke.js';

describe('packaged release launch smoke (#357)', () => {
  test('does not intercept normal launches', () => {
    const exits: number[] = [];
    assert.equal(exitForReleaseSmokeIfRequested({ exit: (code) => exits.push(code) }, ['Overlook']), false);
    assert.deepEqual(exits, []);
  });

  test('emits a stable readiness boundary for the verifier', () => {
    let marker = '';
    const exits: number[] = [];
    assert.equal(
      exitForReleaseSmokeIfRequested({ exit: (code) => exits.push(code) }, ['Overlook', RELEASE_SMOKE_ARGUMENT], (value) => {
        marker = value;
      }),
      true,
    );
    assert.equal(marker, `${RELEASE_SMOKE_READY_MARKER}\n`);
    assert.deepEqual(exits, [0]);
  });
});
