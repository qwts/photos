import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { namedFormats } from '../../src/shared/i18n/formats.js';

describe('i18n formats seam', () => {
  test('exposes a short date preset the renderer and #404 formatters share', () => {
    assert.deepEqual(namedFormats.date.short, { year: 'numeric', month: 'short', day: 'numeric' });
  });

  test('the preset is valid Intl.DateTimeFormat options', () => {
    const formatted = new Intl.DateTimeFormat('en', namedFormats.date.short).format(new Date('2026-07-17T00:00:00Z'));
    assert.match(formatted, /2026/u);
  });
});
