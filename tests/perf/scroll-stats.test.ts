import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { summarizeScrollTrials } from './scroll-stats.js';

describe('performance scroll aggregation (#432)', () => {
  test('gates drop rate on the median while retaining every native-window trial', () => {
    const trials = [
      { frames: 152, dropped: 49, worstMs: 114.8, dropRate: 49 / 152 },
      { frames: 165, dropped: 42, worstMs: 102.1, dropRate: 42 / 165 },
      { frames: 147, dropped: 46, worstMs: 126.5, dropRate: 46 / 147 },
    ] as const;

    const summary = summarizeScrollTrials(trials);

    assert.equal(summary.trials, trials);
    assert.equal(summary.medianDropRate, 46 / 147);
    assert.equal(summary.maxWorstMs, 126.5);
  });

  test('maximum worst frame cannot be hidden by otherwise fast trials', () => {
    const summary = summarizeScrollTrials([
      { frames: 150, dropped: 30, worstMs: 70, dropRate: 0.2 },
      { frames: 150, dropped: 31, worstMs: 501, dropRate: 31 / 150 },
      { frames: 150, dropped: 29, worstMs: 60, dropRate: 29 / 150 },
    ]);

    assert.equal(summary.medianDropRate, 0.2);
    assert.equal(summary.maxWorstMs, 501);
  });

  test('rejects incomplete evidence instead of silently reducing sample count', () => {
    assert.throws(
      () => summarizeScrollTrials([{ frames: 150, dropped: 30, worstMs: 70, dropRate: 0.2 }]),
      /expected 3 scroll trials/u,
    );
  });
});
