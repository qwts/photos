import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFAULT_ORIENTATION,
  ZOOM_MAX,
  ZOOM_MIN,
  clampTransform,
  fillZoom,
  fitSize,
  orientedSize,
  rotateOrientation,
  panBy,
  zoomAround,
} from '../../src/renderer/src/lightbox/geometry.js';

function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${String(actual)} should be close to ${String(expected)}`);
}

describe('lightbox transform geometry (#307)', () => {
  test('fit keeps landscape and portrait images wholly visible', () => {
    const landscape = fitSize({ width: 600, height: 400 }, { width: 400, height: 400 });
    assert.equal(landscape.width, 400);
    assertClose(landscape.height, 400 / 1.5);
    const portrait = fitSize({ width: 400, height: 600 }, { width: 400, height: 400 });
    assertClose(portrait.width, 400 / 1.5);
    assert.equal(portrait.height, 400);
  });

  test('fill is orientation-aware and a deterministic no-op when already filled', () => {
    assertClose(fillZoom({ width: 600, height: 400 }, { width: 400, height: 400 }), 1.5);
    assertClose(fillZoom({ width: 400, height: 600 }, { width: 400, height: 400 }), 1.5);
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

  test('quarter turns swap fit axes and normalize after a complete rotation', () => {
    const clockwise = rotateOrientation(DEFAULT_ORIENTATION, 1);
    assert.deepEqual(clockwise, { quarterTurns: 1, flipped: false });
    assert.deepEqual(orientedSize({ width: 700, height: 525 }, clockwise), { width: 525, height: 700 });

    const completeTurn = [1, 2, 3, 4].reduce((orientation) => rotateOrientation(orientation, 1), DEFAULT_ORIENTATION);
    assert.deepEqual(completeTurn, DEFAULT_ORIENTATION);
  });
});
