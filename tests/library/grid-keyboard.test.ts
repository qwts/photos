import assert from 'node:assert/strict';
import test from 'node:test';

import { moveGridFocus } from '../../src/shared/library/grid-keyboard.js';

const base = { index: 5, count: 20, columns: 4, pageRows: 2, direction: 'ltr' as const };

test('grid keyboard movement covers arrows, row bounds, pages, and ends (#399)', () => {
  assert.equal(moveGridFocus({ ...base, key: 'ArrowRight' }), 6);
  assert.equal(moveGridFocus({ ...base, key: 'ArrowLeft' }), 4);
  assert.equal(moveGridFocus({ ...base, key: 'ArrowDown' }), 9);
  assert.equal(moveGridFocus({ ...base, key: 'ArrowUp' }), 1);
  assert.equal(moveGridFocus({ ...base, key: 'Home' }), 4);
  assert.equal(moveGridFocus({ ...base, key: 'End' }), 7);
  assert.equal(moveGridFocus({ ...base, key: 'PageDown' }), 13);
  assert.equal(moveGridFocus({ ...base, key: 'PageUp' }), 0);
  assert.equal(moveGridFocus({ ...base, key: 'ArrowUp', index: 1 }), 1);
  assert.equal(moveGridFocus({ ...base, key: 'ArrowDown', index: 18 }), 18);
});

test('horizontal movement follows reading direction while Home and End stay logical (#399)', () => {
  assert.equal(moveGridFocus({ ...base, key: 'ArrowRight', direction: 'rtl' }), 4);
  assert.equal(moveGridFocus({ ...base, key: 'ArrowLeft', direction: 'rtl' }), 6);
  assert.equal(moveGridFocus({ ...base, key: 'Home', direction: 'rtl' }), 4);
  assert.equal(moveGridFocus({ ...base, key: 'End', direction: 'rtl' }), 7);
});
