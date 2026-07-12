// Perf instrumentation hook (#74) for M11's budgets: counts rAF frames that
// exceed 1.5 frame periods while the grid is scrolling. Stats are exposed on
// globalThis so E2E flows and manual baselines can read them without UI.

export interface FrameStats {
  frames: number;
  dropped: number;
  /** Longest frame-to-frame delta observed, in ms. */
  worstMs: number;
}

const FRAME_BUDGET_MS = 1000 / 60;
const DROP_THRESHOLD_MS = FRAME_BUDGET_MS * 1.5;

declare global {
  var __overlookFrameStats: FrameStats | undefined;
}

export function createFrameMonitor(): { start: () => void; stop: () => void } {
  let running = false;
  let last = 0;
  let handle = 0;
  const stats: FrameStats = globalThis.__overlookFrameStats ?? { frames: 0, dropped: 0, worstMs: 0 };
  globalThis.__overlookFrameStats = stats;

  const tick = (now: number): void => {
    if (!running) {
      return;
    }
    if (last > 0) {
      const delta = now - last;
      stats.frames += 1;
      if (delta > DROP_THRESHOLD_MS) {
        stats.dropped += 1;
      }
      if (delta > stats.worstMs) {
        stats.worstMs = delta;
      }
    }
    last = now;
    handle = requestAnimationFrame(tick);
  };

  return {
    start: (): void => {
      if (running) {
        return;
      }
      running = true;
      last = 0;
      handle = requestAnimationFrame(tick);
    },
    stop: (): void => {
      running = false;
      cancelAnimationFrame(handle);
    },
  };
}
