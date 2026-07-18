import { test, expect, _electron as electron } from '@playwright/test';

import type { OverlookApi } from '../../src/shared/ipc/api.js';

import { mkE2eTmpDir } from './support/tmp-dir.js';

// #72 exit criteria: the app boots against a seeded fresh temp profile and
// the library is really there — encrypted blobs, SQLCipher rows — behind the
// typed bridge; #75: thumbs decrypt over the protocol into real images.
// Interactive browse flows live in browse.spec.ts (#82).
test('boots a seeded temp profile deterministically', async () => {
  const userData = mkE2eTmpDir('overlook-e2e-profile-');
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
    // With photos present the shell renders the grid engine (#74), not the
    // empty-state placeholder.
    await page.getByTestId('virtual-grid').waitFor();

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

    // #73/#74: the composed shell surfaces the seeded library — sidebar
    // count, statusbar total, one grid cell per seeded photo.
    await expect(page.getByRole('button', { name: 'All Photos 12' })).toBeVisible();
    await expect(page.getByTestId('statusbar-left')).toContainText('12 PHOTOS ·');
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(12);

    // #76/#127: cells are real PhotoTiles whose licensed-photo thumbs decode
    // through the encrypted protocol.
    await expect(page.locator('.ovl-tile__img').first()).toHaveJSProperty('naturalWidth', 1280);

    // #75: thumbs decrypt over overlook-thumb:// straight into <img>; a
    // missing id errors so the renderer keeps its placeholder. String-form
    // evaluate: the tests project has no DOM lib.
    const thumb = await page.evaluate<{ ok: boolean; width: number }>(`new Promise((resolve) => {
      const el = new Image();
      el.onload = () => resolve({ ok: true, width: el.naturalWidth });
      el.onerror = () => resolve({ ok: false, width: 0 });
      el.src = 'overlook-thumb://library/01J8SEEDPHOTO0000?size=thumb';
    })`);
    expect(thumb).toEqual({ ok: true, width: 1280 });
    const missing = await page.evaluate<boolean>(`new Promise((resolve) => {
      const el = new Image();
      el.onload = () => resolve(true);
      el.onerror = () => resolve(false);
      el.src = 'overlook-thumb://library/01J8DOESNOTEXIST?size=thumb';
    })`);
    expect(missing).toBe(false);
  } finally {
    await app.close();
  }
});
