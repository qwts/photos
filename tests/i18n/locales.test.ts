import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCE_LOCALE,
  baseLanguage,
  fallbackChain,
  directionOf,
  resolveLocale,
  resolveRuntimeLocale,
} from '../../src/shared/i18n/locales.js';

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

describe('locale model: resolveRuntimeLocale (OVERLOOK_LOCALE pin)', () => {
  test('an unpackaged build honours a pinned shipped or pseudo locale', () => {
    assert.equal(resolveRuntimeLocale({ pinned: 'en-XA', packaged: false, osLocale: 'de-DE' }), 'en-XA');
    assert.equal(resolveRuntimeLocale({ pinned: 'en-XB', packaged: false, osLocale: 'de-DE' }), 'en-XB');
    assert.equal(resolveRuntimeLocale({ pinned: 'en', packaged: false, osLocale: 'de-DE' }), 'en');
  });

  test('a packaged build ignores the pin and negotiates the OS locale', () => {
    assert.equal(resolveRuntimeLocale({ pinned: 'en-XA', packaged: true, osLocale: 'en-US' }), 'en');
    assert.equal(resolveRuntimeLocale({ pinned: 'en-XB', packaged: true, osLocale: 'fr-FR' }), SOURCE_LOCALE);
  });

  test('an unknown or absent pin falls through to OS negotiation', () => {
    assert.equal(resolveRuntimeLocale({ pinned: 'zz-ZZ', packaged: false, osLocale: 'en-GB' }), 'en');
    assert.equal(resolveRuntimeLocale({ pinned: undefined, packaged: false, osLocale: 'ja-JP' }), SOURCE_LOCALE);
  });

  test('a regional variant of a pinnable locale is honoured verbatim (PR #473)', () => {
    // en-US must pin the region for deterministic Intl output; messages fall
    // back to the en catalog in the loader.
    assert.equal(resolveRuntimeLocale({ pinned: 'en-US', packaged: false, osLocale: 'de-DE' }), 'en-US');
    // A regional variant of a NON-shipped language still falls through.
    assert.equal(resolveRuntimeLocale({ pinned: 'de-DE', packaged: false, osLocale: 'ja-JP' }), SOURCE_LOCALE);
  });
});
