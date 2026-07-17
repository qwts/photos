import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StartupMaintenance, type StartupRepairSummary } from '../../src/main/library/startup-maintenance.js';

const emptySummary: StartupRepairSummary = {
  orphanOriginals: [],
  orphanThumbs: [],
  stagedLeftovers: [],
  lyingRows: [],
};

test('startup maintenance is cancellable before launch and drainable after launch (#311)', async () => {
  let starts = 0;
  let releasePurge: (() => void) | undefined;
  let releaseRepair: (() => void) | undefined;
  let releaseRawRepair: (() => void) | undefined;
  const purge = new Promise<void>((resolve) => {
    releasePurge = resolve;
  });
  const repair = new Promise<StartupRepairSummary>((resolve) => {
    releaseRepair = () => resolve(emptySummary);
  });
  const rawRepair = new Promise<{ scanned: number; repaired: number; failed: number; skipped: number }>((resolve) => {
    releaseRawRepair = () => resolve({ scanned: 1, repaired: 1, failed: 0, skipped: 0 });
  });
  const maintenance = new StartupMaintenance({
    purge: () => {
      starts += 1;
      return purge;
    },
    repair: () => repair,
    rawRepair: () => rawRepair,
  });

  maintenance.schedule();
  maintenance.cancel();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(starts, 0);

  maintenance.schedule();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(starts, 1);
  let drained = false;
  const draining = maintenance.drain().then(() => {
    drained = true;
  });
  releasePurge?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);
  releaseRepair?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);
  releaseRawRepair?.();
  await draining;
  assert.equal(drained, true);
});

test('drain waits on search index verification too, and it is optional (#390)', async () => {
  let releaseVerify: ((rebuilt: boolean) => void) | undefined;
  const verify = new Promise<{ rebuilt: boolean }>((resolve) => {
    releaseVerify = (rebuilt) => resolve({ rebuilt });
  });
  const maintenance = new StartupMaintenance({
    purge: () => Promise.resolve(),
    repair: () => Promise.resolve(emptySummary),
    verifySearchIndex: () => verify,
  });

  maintenance.schedule();
  await new Promise((resolve) => setTimeout(resolve, 5));
  let drained = false;
  const draining = maintenance.drain().then(() => {
    drained = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);
  releaseVerify?.(true);
  await draining;
  assert.equal(drained, true);

  // Undefined (no library open yet) is a no-op, same convention as `repair`.
  const skipped = new StartupMaintenance({
    purge: () => Promise.resolve(),
    repair: () => Promise.resolve(emptySummary),
    verifySearchIndex: () => undefined,
  });
  skipped.schedule();
  await skipped.drain();
});
