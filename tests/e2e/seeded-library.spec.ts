import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';

import type { OverlookApi } from '../../src/shared/ipc/api.js';

// #72 exit criteria: the app boots against a seeded fresh temp profile and
// the library is really there — encrypted blobs, SQLCipher rows — behind the
// typed bridge. OVERLOOK_INSECURE_KEYSTORE keeps CI runners (no secret
// service) working; unpackaged-only, per the recorded decision.
test('boots a seeded temp profile deterministically', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-profile-'));
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '12',
      OVERLOOK_INSECURE_KEYSTORE: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('#root p');

    const result = await page.evaluate(async () => {
      const overlook = (globalThis as unknown as { overlook: OverlookApi }).overlook;
      const stats = await overlook.library.stats();
      const firstPage = await overlook.library.page({ source: 'all', limit: 5 });
      const counts = await overlook.library.counts({ recentSince: '2026-06-01T00:00:00.000Z' });
      return { stats, ids: firstPage.photos.map((photo) => photo.id), counts };
    });

    expect(result.stats.photos).toBe(12);
    expect(result.ids).toHaveLength(5);
    // Deterministic seed ids — stable assertions for future acceptance flows.
    for (const id of result.ids) {
      expect(id).toMatch(/^01J8SEEDPHOTO\d{4}$/);
    }
    expect(result.counts.all).toBe(12);
    expect(result.counts.offloaded).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});
