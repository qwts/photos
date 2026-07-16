import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { idleLimitSeconds } from '../../src/main/crypto/app-lock-policy.js';

describe('app-lock lifecycle policy (#311)', () => {
  test('idle choices map to the ADR-0013 limits and Never stays explicit', () => {
    assert.equal(idleLimitSeconds('1'), 60);
    assert.equal(idleLimitSeconds('5'), 300);
    assert.equal(idleLimitSeconds('15'), 900);
    assert.equal(idleLimitSeconds('30'), 1_800);
    assert.equal(idleLimitSeconds('never'), null);
  });
});
