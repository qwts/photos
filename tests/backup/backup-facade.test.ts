import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBackupFacade } from '../../src/main/backup/backup-facade.js';
import type { OffloadService } from '../../src/main/backup/offload.js';
import type { EphemeralOriginalService } from '../../src/main/backup/ephemeral-originals.js';
import type { ProviderRuntime } from '../../src/main/backup/provider-runtime.js';

function runtime(activeId = 'mock'): ProviderRuntime {
  return { activeId: () => activeId } as unknown as ProviderRuntime;
}

function offloadService(activeWork: () => number, reject = false): OffloadService {
  return {
    preflight: () => {
      assert.equal(activeWork(), 1);
      return Promise.resolve({ eligible: 0, ineligible: 0, estimatedFreedBytes: 0, items: [] });
    },
    offload: () => {
      assert.equal(activeWork(), 1);
      return reject
        ? Promise.reject(new Error('delete failed'))
        : Promise.resolve({ offloaded: 0, skipped: 0, failed: 0, freedBytes: 0, results: [] });
    },
    rehydrate: () => {
      assert.equal(activeWork(), 1);
      return Promise.resolve();
    },
    restoreOriginals: () => {
      assert.equal(activeWork(), 1);
      return Promise.resolve({ restored: 0, skipped: 0, failed: 0, results: [] });
    },
  } as unknown as OffloadService;
}

const ephemeralOriginalService = {
  keepDownloaded: () => Promise.resolve(),
  release: () => Promise.resolve(),
  status: () => null,
} as unknown as EphemeralOriginalService;

test('offload and restore work hold the provider-switch lock for their full async lifetime (#281)', async () => {
  let activeWork = 0;
  const facade = createBackupFacade({
    runtime: () => runtime(),
    run: () =>
      Promise.resolve({
        uploaded: 0,
        failed: 0,
        skipped: null,
        integrity: { checked: 0, repaired: 0, unrecoverable: 0, recoveryRepaired: false, failed: false },
      }),
    offloadService: () => offloadService(() => activeWork),
    ephemeralOriginalService: () => ephemeralOriginalService,
    workChanged: (delta) => (activeWork += delta),
  });

  await facade.offloadPreflight(['P1']);
  assert.equal(activeWork, 0);
  await facade.offload(['P1']);
  assert.equal(activeWork, 0);
  await facade.rehydrate('P1');
  assert.equal(activeWork, 0);
  await facade.restoreOriginals();
  assert.equal(activeWork, 0);
});

test('provider work lock releases when an offload operation rejects (#281)', async () => {
  let activeWork = 0;
  const facade = createBackupFacade({
    runtime: () => runtime(),
    run: () => Promise.reject(new Error('unused')),
    offloadService: () => offloadService(() => activeWork, true),
    ephemeralOriginalService: () => ephemeralOriginalService,
    workChanged: (delta) => (activeWork += delta),
  });

  await assert.rejects(facade.offload(['P1']), /delete failed/u);
  assert.equal(activeWork, 0);
});
