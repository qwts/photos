import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { formatCount } from '../../src/shared/library/format.js';

describe('copy rules: counts', () => {
  test('thousands separators per the design copy rules (#78)', () => {
    assert.equal(formatCount(0), '0');
    assert.equal(formatCount(12), '12');
    assert.equal(formatCount(1234), '1,234');
    assert.equal(formatCount(200_000), '200,000');
  });
});
