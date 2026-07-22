import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLACEMENT_AVAILABILITIES,
  canRenderPixels,
  exportDisposition,
  isSkipped,
  neverRasterizes,
} from '../../src/shared/moodboard/availability.js';

describe('availability (I6 locked isolation)', () => {
  test('locked content never rasterizes anywhere', () => {
    assert.equal(neverRasterizes('locked'), true);
    assert.equal(canRenderPixels('locked'), false);
    assert.equal(exportDisposition('locked'), 'skip-locked');
    for (const availability of PLACEMENT_AVAILABILITIES) {
      if (availability !== 'locked') assert.equal(neverRasterizes(availability), false);
    }
  });

  test('available and offloaded render pixels', () => {
    assert.equal(canRenderPixels('available'), true);
    assert.equal(canRenderPixels('offloaded'), true);
  });

  test('unavailable holds a placeholder slot, no pixels', () => {
    assert.equal(canRenderPixels('unavailable'), false);
    assert.equal(exportDisposition('unavailable'), 'skip-unavailable');
  });

  test('export dispositions map correctly', () => {
    assert.equal(exportDisposition('available'), 'render');
    assert.equal(exportDisposition('offloaded'), 'render');
    assert.equal(isSkipped('render'), false);
    assert.equal(isSkipped('skip-locked'), true);
    assert.equal(isSkipped('skip-unavailable'), true);
  });
});
