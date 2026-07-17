import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { SOURCE_LOCALE, baseLanguage, fallbackChain, directionOf, resolveLocale } from '../../src/shared/i18n/locales.js';

describe('locale model: baseLanguage', () => {
  test('takes the primary subtag, lowercased', () => {
    assert.equal(baseLanguage('pt-BR'), 'pt');
    assert.equal(baseLanguage('EN'), 'en');
    assert.equal(baseLanguage('ar'), 'ar');
  });
});

describe('locale model: fallbackChain', () => {
  test('walks most-specific to least, source excluded', () => {
    assert.deepEqual(fallbackChain('pt-BR'), ['pt-BR', 'pt']);
    assert.deepEqual(fallbackChain('zh-Hant-TW'), ['zh-Hant-TW', 'zh-Hant', 'zh']);
    assert.deepEqual(fallbackChain('en'), ['en']);
  });
});

describe('locale model: directionOf', () => {
  test('RTL base languages and their regional variants are rtl', () => {
    for (const tag of ['ar', 'ar-EG', 'he', 'fa-IR', 'ur-PK']) {
      assert.equal(directionOf(tag), 'rtl', tag);
    }
  });

  test('the en-XB bidi pseudo-locale is force-rtl', () => {
    assert.equal(directionOf('en-XB'), 'rtl');
  });

  test('everything else is ltr, including the en-XA accent pseudo', () => {
    for (const tag of ['en', 'en-XA', 'de', 'fr', 'ja']) {
      assert.equal(directionOf(tag), 'ltr', tag);
    }
  });
});

describe('locale model: resolveLocale (ADR §2 order + fallback chain)', () => {
  const available = ['en', 'de', 'pt'];

  test('setting wins over OS locale', () => {
    assert.equal(resolveLocale(['de', 'pt'], available), 'de');
  });

  test('a null setting (follow OS) falls through to the OS locale', () => {
    assert.equal(resolveLocale([null, 'pt'], available), 'pt');
  });

  test('regional requests fall back to their base language', () => {
    assert.equal(resolveLocale(['pt-BR'], available), 'pt');
  });

  test('unavailable preferences fall back to the source locale', () => {
    assert.equal(resolveLocale(['ja', 'ko'], available), SOURCE_LOCALE);
    assert.equal(resolveLocale([null, undefined, ''], available), SOURCE_LOCALE);
  });

  test('defaults to the shipped set (en-only at launch)', () => {
    assert.equal(resolveLocale(['de']), SOURCE_LOCALE);
    assert.equal(resolveLocale(['en-US']), 'en');
  });
});
