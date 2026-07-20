import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { formatBytes, formatCalendarDate, formatCount, formatRelativeTime } from '../../src/shared/i18n/formats.js';

describe('locale-aware presentation formats', () => {
  test('counts follow the active locale and CLDR digit defaults', () => {
    assert.equal(formatCount('en', 1234), '1,234');
    assert.equal(formatCount('de', 1234), '1.234');
    assert.equal(formatCount('fr', 1234), '1 234');
    assert.equal(formatCount('ar-EG', 1234), '١٬٢٣٤');
  });

  test('storage sizes keep the SI ladder and localize values and units', () => {
    assert.equal(formatBytes('en', 0), '0 byte');
    assert.equal(formatBytes('en', 98_400_000), '98.4 MB');
    assert.equal(formatBytes('de', 1_200_000_000_000), '1,2 TB');
    assert.equal(formatBytes('fr', 380_000_000_000), '380 Go');
  });

  test('relative times use natural-case CLDR copy', () => {
    const now = Date.parse('2026-07-12T12:00:00.000Z');
    assert.equal(formatRelativeTime('en', '2026-07-12T11:59:40.000Z', now), 'now');
    assert.equal(formatRelativeTime('en', '2026-07-12T11:55:00.000Z', now), '5m ago');
    assert.equal(formatRelativeTime('de', '2026-07-12T10:00:00.000Z', now), 'vor 2 Std.');
    assert.equal(formatRelativeTime('ja', '2026-07-09T12:00:00.000Z', now), '3日前');
    // Clock skew and garbage degrade safely.
    assert.equal(formatRelativeTime('en', '2026-07-12T12:01:00.000Z', now), 'now');
    assert.equal(formatRelativeTime('en', 'not-a-date', now), 'now');
  });

  test('calendar dates localize without host-zone day shifts', () => {
    assert.equal(formatCalendarDate('en', '2026-07-12T23:59:00-10:00'), 'Jul 12, 2026');
    assert.equal(formatCalendarDate('de', '2026-07-12T00:00:00.000Z'), '12. Juli 2026');
    assert.equal(formatCalendarDate('ja', '2026-07-12'), '2026年7月12日');
    assert.equal(formatCalendarDate('en', 'not-a-date'), '—');
  });
});
