import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ZOOM_MAX, ZOOM_MIN, clampTransform, fillZoom, fitSize, panBy, zoomAround } from '../../src/renderer/src/lightbox/geometry.js';

describe('lightbox transform geometry (#307)', () => {
  test('fit keeps landscape and portrait images wholly visible', () => {
    assert.deepEqual(fitSize({ width: 600, height: 400 }, { width: 400, height: 400 }), {
      width: 400,
      height: 400 / 1.5,
    });
    assert.deepEqual(fitSize({ width: 400, height: 600 }, { width: 400, height: 400 }), {
      width: 400 / 1.5,
      height: 400,
    });
  });

  test('fill is orientation-aware and a deterministic no-op when already filled', () => {
    assert.equal(fillZoom({ width: 600, height: 400 }, { width: 400, height: 400 }), 1.5);
    assert.equal(fillZoom({ width: 400, height: 600 }, { width: 400, height: 400 }), 1.5);
    assert.equal(fillZoom({ width: 6000, height: 4000 }, { width: 1200, height: 800 }), 1);
  });

  test('pan clamps both axes without exposing space beyond an edge', () => {
    const fitted = { width: 400, height: 400 / 1.5 };
    assert.deepEqual(panBy({ zoom: 2, x: 0, y: 0 }, { x: 999, y: -999 }, fitted, { width: 400, height: 400 }), {
      zoom: 2,
      x: 200,
      y: -(400 / 1.5 - 200),
    });
  });

  test('zoom preserves the focal image point and stays within 0.25x-8x', () => {
    const fitted = { width: 400, height: 400 / 1.5 };
    const viewport = { width: 400, height: 400 };
    assert.deepEqual(zoomAround({ zoom: 1, x: 0, y: 0 }, 2, { x: 100, y: 200 }, fitted, viewport), {
      zoom: 2,
      x: 100,
      y: 0,
    });
    assert.equal(zoomAround({ zoom: 1, x: 0, y: 0 }, 99, { x: 200, y: 200 }, fitted, viewport).zoom, ZOOM_MAX);
    assert.equal(zoomAround({ zoom: 1, x: 0, y: 0 }, 0, { x: 200, y: 200 }, fitted, viewport).zoom, ZOOM_MIN);
  });

  test('resize reclamps the current transform', () => {
    assert.deepEqual(clampTransform({ zoom: 2, x: 500, y: 500 }, { width: 300, height: 200 }, { width: 400, height: 300 }), {
      zoom: 2,
      x: 100,
      y: 50,
    });
  });
});
