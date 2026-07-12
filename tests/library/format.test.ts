import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { formatBytes, formatCount } from '../../src/shared/library/format.js';

describe('copy rules: counts', () => {
  test('thousands separators per the design copy rules (#78)', () => {
    assert.equal(formatCount(0), '0');
    assert.equal(formatCount(12), '12');
    assert.equal(formatCount(1234), '1,234');
    assert.equal(formatCount(200_000), '200,000');
  });

  test('storage sizes round like the chrome copy (#80)', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(842), '842 B');
    assert.equal(formatBytes(98_400_000), '98.4 MB');
    assert.equal(formatBytes(1_200_000_000_000), '1.2 TB');
    assert.equal(formatBytes(380_000_000_000), '380 GB');
  });
});
