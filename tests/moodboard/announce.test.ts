import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  announceAdded,
  announceAligned,
  announceBroughtForward,
  announceDistributed,
  announceExported,
  announceGrouped,
  announceMoved,
  announceRemoved,
  announceResized,
  announceSentBack,
  announceSkipped,
  announceUngrouped,
} from '../../src/shared/moodboard/announce.js';

// Exact spec strings from the design's §05 announcements table (I5).
describe('live-region announcements', () => {
  test('move / resize on release', () => {
    assert.equal(announceMoved(320, 180), 'Moved to 320, 180.');
    assert.equal(announceResized(480, 360), 'Resized to 480 × 360.');
  });

  test('rounds fractional inputs', () => {
    assert.equal(announceMoved(319.6, 180.2), 'Moved to 320, 180.');
  });

  test('layer change', () => {
    assert.equal(announceBroughtForward(5, 14), 'Brought forward. Layer 5 of 14.');
    assert.equal(announceSentBack(2, 14), 'Sent back. Layer 2 of 14.');
  });

  test('group / ungroup', () => {
    assert.equal(announceGrouped(3), 'Grouped 3 photos.');
    assert.equal(announceUngrouped(), 'Ungrouped.');
  });

  test('align / distribute', () => {
    assert.equal(announceAligned('left'), 'Aligned left.');
    assert.equal(announceAligned('hcenter'), 'Aligned center.');
    assert.equal(announceAligned('vmiddle'), 'Aligned middle.');
    assert.equal(announceDistributed('horizontal'), 'Distributed horizontally.');
    assert.equal(announceDistributed('vertical'), 'Distributed vertically.');
  });

  test('add / remove', () => {
    assert.equal(announceAdded(), 'Added to board.');
    assert.equal(announceRemoved(), 'Removed from board.');
  });

  test('export', () => {
    assert.equal(announceExported(1600, 1200), 'Board exported at 1600 × 1200.');
    assert.equal(announceSkipped(2), '2 placements skipped — locked or unavailable.');
  });
});
