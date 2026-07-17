export interface ScrollTrial {
  readonly frames: number;
  readonly dropped: number;
  readonly worstMs: number;
  readonly dropRate: number;
}

export interface ScrollStats {
  readonly trials: readonly ScrollTrial[];
  readonly medianDropRate: number;
  readonly maxWorstMs: number;
}

export const SCROLL_TRIAL_COUNT = 3;

export function summarizeScrollTrials(trials: readonly ScrollTrial[]): ScrollStats {
  if (trials.length !== SCROLL_TRIAL_COUNT) {
    throw new Error(`expected ${String(SCROLL_TRIAL_COUNT)} scroll trials, received ${String(trials.length)}`);
  }
  const dropRates = trials.map(({ dropRate }) => dropRate).sort((left, right) => left - right);
  return {
    trials,
    medianDropRate: dropRates[1] ?? 0,
    maxWorstMs: Math.max(...trials.map(({ worstMs }) => worstMs)),
  };
}
