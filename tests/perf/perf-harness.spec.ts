import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';
import type { Page } from '@playwright/test';

import { sampleJpeg } from '../../src/main/library/seed.js';
import { BUDGETS, type PerfReport } from './budgets.js';

// #123: the 200K target becomes measurable — one harness, written budgets
// (ratchets: never loosen), a stable report. Runs the E4.8 synthetic
// profile (metadata-only rows over one shared blob), measures cold start,
// query latency, scroll frame drops at three zooms, import throughput, and
// memory ceilings, then asserts every budget.

// Env-tunable for harness debugging (`OVERLOOK_PERF_SIZE=20000`); the
// recorded budgets/baselines are the 200K default.
const LIBRARY_SIZE = Number(process.env['OVERLOOK_PERF_SIZE'] ?? '200000');
const QUERY_ROUNDS = 5;
const IMPORT_FILES = 100;

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function queryMedianMs(page: Page, expression: string): Promise<number> {
  const samples: number[] = [];
  for (let round = 0; round < QUERY_ROUNDS; round += 1) {
    samples.push(
      await page.evaluate<number>(`(async () => { const t0 = performance.now(); await ${expression}; return performance.now() - t0; })()`),
    );
  }
  return median(samples);
}

interface FrameStats {
  frames: number;
  dropped: number;
  worstMs: number;
}

async function scrollRun(page: Page, zoom: number): Promise<FrameStats & { dropRate: number }> {
  await page.getByRole('slider', { name: 'Zoom' }).fill(String(zoom));
  const grid = page.getByTestId('virtual-grid');
  await grid.hover();
  // Jump back to the top, settle, then reset the monitor.
  await page.mouse.wheel(0, -100_000_000);
  await page.waitForTimeout(300);
  await page.evaluate(`(() => { const s = globalThis.__overlookFrameStats; if (s) { s.frames = 0; s.dropped = 0; s.worstMs = 0; } })()`);
  // A sustained mixed scroll: 30 wheel bursts through the virtualized plane.
  for (let burst = 0; burst < 30; burst += 1) {
    await page.mouse.wheel(0, 4_000);
    await page.waitForTimeout(50);
  }
  const stats = await page.evaluate<FrameStats>(`globalThis.__overlookFrameStats ?? { frames: 0, dropped: 0, worstMs: 0 }`);
  return { ...stats, dropRate: stats.frames === 0 ? 0 : stats.dropped / stats.frames };
}

test('200K perf harness: cold start, queries, scroll, import, memory', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'overlook-perf-'));
  const env = {
    ...process.env,
    OVERLOOK_USER_DATA: userData,
    OVERLOOK_SEED_SYNTHETIC: String(LIBRARY_SIZE),
    OVERLOOK_INSECURE_KEYSTORE: '1',
  };

  // Seeding run (untimed): materialize the library once, then close — the
  // cold-start metric below measures the PRODUCT case, opening an existing
  // library, not the one-time synthetic insert.
  {
    const seeder = await electron.launch({ args: ['.'], env });
    const seedPage = await seeder.firstWindow();
    await expect(seedPage.getByTestId('statusbar-left')).toContainText(`${LIBRARY_SIZE.toLocaleString('en-US')} PHOTOS ·`, {
      timeout: 180_000,
    });
    await seeder.close();
  }

  const launchStarted = Date.now();
  const app = await electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();

    // Cold start: launch → the existing 200K grid is interactive.
    await expect(page.getByTestId('statusbar-left')).toContainText(`${LIBRARY_SIZE.toLocaleString('en-US')} PHOTOS ·`, {
      timeout: 120_000,
    });
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell').first()).toBeVisible();
    const coldStartMs = Date.now() - launchStarted;
    console.log(`[perf] cold start ${String(coldStartMs)}ms`);

    // Query latency (median of rounds) over the real IPC boundary.
    const page500Ms = await queryMedianMs(page, `window.overlook.library.page({ source: 'all', limit: 500 })`);
    const countsMs = await queryMedianMs(page, `window.overlook.library.counts({ recentSince: '2026-01-01T00:00:00.000Z' })`);
    const searchMs = await queryMedianMs(
      page,
      // A real place substring — matches spread across the whole library,
      // so the instr() scan pays full price (mock search semantics, #71).
      `window.overlook.library.page({ source: 'all', limit: 500, query: 'lisbon' })`,
    );

    console.log(`[perf] queries page=${page500Ms.toFixed(0)}ms counts=${countsMs.toFixed(0)}ms search=${searchMs.toFixed(0)}ms`);

    // Import throughput: unique real files through the full pipeline
    // (copy + encrypt + record + thumbs).
    const source = join(mkdtempSync(join(tmpdir(), 'overlook-perf-import-')), 'CARD');
    mkdirSync(source);
    for (let index = 0; index < IMPORT_FILES; index += 1) {
      writeFileSync(join(source, `PERF_${String(index).padStart(4, '0')}.jpg`), sampleJpeg(1_000_000 + index));
    }
    // Isolate the measurement: the harness times the import pipeline, not
    // a concurrent backup of what it just imported.
    await page.evaluate(`window.overlook.settings.set({ patch: { autoBackupOnImport: false } })`);
    console.log('[perf] import starting');
    const importStarted = Date.now();
    const summary = await page.evaluate<{ imported: number }>(
      `window.overlook.import.run({ path: ${JSON.stringify(source)}, mode: 'copy' })`,
    );
    const importSeconds = (Date.now() - importStarted) / 1000;
    expect(summary.imported).toBe(IMPORT_FILES);
    const importPhotosPerSec = IMPORT_FILES / importSeconds;

    // Scroll frame drops at the three design zooms.
    const scroll = {
      zoom96: await scrollRun(page, 96),
      zoom160: await scrollRun(page, 160),
      zoom320: await scrollRun(page, 320),
    };
    console.log('[perf] scroll done', JSON.stringify(scroll));

    // Memory ceilings after the workout.
    const mainRssMb = await app.evaluate(() => Promise.resolve(process.memoryUsage().rss / 1024 / 1024));
    const rendererHeapMb = await page.evaluate<number>(`(performance).memory ? (performance).memory.usedJSHeapSize / 1024 / 1024 : 0`);

    const report: PerfReport = {
      librarySize: LIBRARY_SIZE,
      coldStartMs,
      page500Ms,
      countsMs,
      searchMs,
      scroll,
      importPhotosPerSec,
      mainRssMb,
      rendererHeapMb,
    };
    writeFileSync(join('test-results', 'perf-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log('[perf] report:', JSON.stringify(report, null, 2));

    // The budgets (ratchets — see wiki Testing-Strategy §Perf budgets).
    expect(coldStartMs, 'cold start').toBeLessThan(BUDGETS.coldStartMs);
    expect(page500Ms, 'page(500) median').toBeLessThan(BUDGETS.page500Ms);
    expect(countsMs, 'counts median').toBeLessThan(BUDGETS.countsMs);
    expect(searchMs, 'search median').toBeLessThan(BUDGETS.searchMs);
    for (const [zoom, stats] of Object.entries(scroll)) {
      expect(stats.dropRate, `${zoom} drop rate`).toBeLessThan(BUDGETS.scrollDropRate);
      expect(stats.worstMs, `${zoom} worst frame`).toBeLessThan(BUDGETS.scrollWorstMs);
    }
    expect(importPhotosPerSec, 'import throughput').toBeGreaterThan(BUDGETS.importPhotosPerSecMin);
    expect(mainRssMb, 'main RSS').toBeLessThan(BUDGETS.mainRssMbMax);
    expect(rendererHeapMb, 'renderer JS heap').toBeLessThan(BUDGETS.rendererHeapMbMax);
  } finally {
    await app.close();
  }
});
