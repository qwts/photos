import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { loadCatalog } from '../../src/renderer/src/i18n/catalog.js';

// Loader behavior over the generated locale registry (#403, PR #473 review):
// the fallback chain must reach the closest compiled catalog so a regional tag
// or an unshipped language renders real copy, never missing ids.

describe('catalog loader', () => {
  test('the source locale returns the compiled en catalog', () => {
    const catalog = loadCatalog('en');
    assert.equal(catalog['toolbar.import'], 'Import');
  });

  test('a regional variant falls back along the chain to its base catalog', () => {
    assert.deepEqual(loadCatalog('en-US'), loadCatalog('en'));
  });

  test('an unshipped language terminally falls back to the source catalog', () => {
    assert.deepEqual(loadCatalog('de'), loadCatalog('en'));
  });

  test('pseudo-locales derive from the source catalog at runtime', () => {
    const pseudo = loadCatalog('en-XA');
    assert.notEqual(pseudo['toolbar.import'], 'Import');
    assert.match(pseudo['toolbar.import'] ?? '', /^⟦.*⟧$/u);
  });
});
