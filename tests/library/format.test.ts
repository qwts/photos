import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { formatBytes, formatCount, formatRelativeTime } from '../../src/shared/library/format.js';

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

  test('relative times speak mono uppercase (#81)', () => {
    const now = Date.parse('2026-07-12T12:00:00.000Z');
    assert.equal(formatRelativeTime('2026-07-12T11:59:40.000Z', now), 'JUST NOW');
    assert.equal(formatRelativeTime('2026-07-12T11:55:00.000Z', now), '5M AGO');
    assert.equal(formatRelativeTime('2026-07-12T10:00:00.000Z', now), '2H AGO');
    assert.equal(formatRelativeTime('2026-07-09T12:00:00.000Z', now), '3D AGO');
    // Clock skew and garbage degrade safely.
    assert.equal(formatRelativeTime('2026-07-12T12:01:00.000Z', now), 'JUST NOW');
    assert.equal(formatRelativeTime('not-a-date', now), 'JUST NOW');
  });
});
