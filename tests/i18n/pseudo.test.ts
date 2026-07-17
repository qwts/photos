import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { isPseudoLocale, toPseudoCatalog } from '../../src/renderer/src/i18n/pseudo.js';

describe('pseudo: isPseudoLocale', () => {
  test('recognises the two generated variants only', () => {
    assert.equal(isPseudoLocale('en-XA'), true);
    assert.equal(isPseudoLocale('en-XB'), true);
    assert.equal(isPseudoLocale('en'), false);
    assert.equal(isPseudoLocale('ar'), false);
  });
});

describe('pseudo: toPseudoCatalog (en-XA)', () => {
  test('accents and pads literal text, keeping ids', () => {
    const out = toPseudoCatalog({ 'settings.title': 'Settings' }, 'en-XA');
    const value = out['settings.title'];
    assert.ok(value !== undefined);
    assert.notEqual(value, 'Settings');
    // Padding brackets surface truncation and length assumptions.
    assert.match(value, /^⟦.*⟧$/u);
  });

  test('preserves ICU placeholders untouched so parsing survives', () => {
    const out = toPseudoCatalog({ 'import.count': '{count} photos imported' }, 'en-XA');
    assert.match(out['import.count'] ?? '', /\{count\}/u);
  });

  test('preserves rich-text tags', () => {
    const out = toPseudoCatalog({ x: 'Keep <b>safe</b>' }, 'en-XA');
    assert.match(out['x'] ?? '', /<b>.*<\/b>/u);
  });
});

describe('pseudo: toPseudoCatalog (en-XB)', () => {
  test('wraps in bidi markers, still preserving ICU', () => {
    const out = toPseudoCatalog({ y: 'Delete {name}?' }, 'en-XB');
    const value = out['y'] ?? '';
    assert.match(value, /\{name\}/u);
    assert.match(value, /⟪.*⟫/u);
  });
});
