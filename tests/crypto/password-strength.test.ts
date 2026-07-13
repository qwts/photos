import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { strengthOf } from '../../src/shared/crypto/password-strength.js';

// The mock's own tiers, pinned (#240): the export button gates on >= 3.
describe('password strength (#240)', () => {
  test('empty is neutral and unlabeled', () => {
    assert.deepEqual(strengthOf(''), { score: 0, label: '', tone: 'neutral' });
  });

  test('short single-class passwords are weak', () => {
    assert.equal(strengthOf('abc').label, 'Weak');
    assert.equal(strengthOf('password').label, 'Weak');
  });

  test('tiers climb with length and character classes', () => {
    assert.equal(strengthOf('Password1').label, 'Fair');
    assert.equal(strengthOf('Password1!').label, 'Strong');
    assert.equal(strengthOf('Correct Horse Battery 9!').label, 'Very strong');
  });
});
