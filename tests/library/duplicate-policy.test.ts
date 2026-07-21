import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { duplicatePairEligible } from '../../src/shared/library/duplicate-policy.js';

describe('duplicate eligibility policy (#482)', () => {
  test('only compares candidates within the same Original classification', () => {
    assert.equal(duplicatePairEligible({ isOriginal: true }, { isOriginal: true }), true);
    assert.equal(duplicatePairEligible({ isOriginal: false }, { isOriginal: false }), true);
    assert.equal(duplicatePairEligible({ isOriginal: true }, { isOriginal: false }), false);
    assert.equal(duplicatePairEligible({ isOriginal: false }, { isOriginal: true }), false);
  });
});
