import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { contrastRatio, relativeLuminance, srgb8 } from '../../src/shared/theme/contrast.js';

describe('WCAG contrast math (#401)', () => {
  test('matches the WCAG black/white reference ratio', () => {
    assert.equal(relativeLuminance(srgb8(0, 0, 0)), 0);
    assert.equal(relativeLuminance(srgb8(255, 255, 255)), 1);
    assert.equal(contrastRatio(srgb8(0, 0, 0), srgb8(255, 255, 255)), 21);
  });

  test('linearizes sRGB channels before computing luminance', () => {
    assert.ok(Math.abs(relativeLuminance(srgb8(255, 0, 0)) - 0.2126) < 0.000_001);
    assert.ok(Math.abs(relativeLuminance(srgb8(0, 255, 0)) - 0.7152) < 0.000_001);
    assert.ok(Math.abs(relativeLuminance(srgb8(0, 0, 255)) - 0.0722) < 0.000_001);
  });

  test('is order-independent and preserves the published AA boundary', () => {
    const black = srgb8(0, 0, 0);
    const boundary = srgb8(116, 116, 116);
    const forward = contrastRatio(black, boundary);
    assert.equal(forward, contrastRatio(boundary, black));
    assert.ok(forward >= 4.5);
  });
});
