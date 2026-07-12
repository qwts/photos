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

    // #73 exit criteria: the composed shell surfaces the seeded library —
    // sidebar count and statusbar total live; #74: the grid engine renders
    // one cell per seeded photo (all 12 fit one window).
    await expect(page.getByRole('button', { name: 'All Photos 12' })).toBeVisible();
    await expect(page.getByTestId('statusbar-left')).toHaveText('12 PHOTOS');
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(12);

    // #76: cells are real PhotoTiles whose <img> decodes through the
    // protocol (the seed thumb is a genuine 1x1 JPEG).
    await expect(page.locator('.ovl-tile__img').first()).toHaveJSProperty('naturalWidth', 1);

    // Source switching refetches the loaded page (PR #154 review): the seed
    // marks every 9th photo favorite, so 12 photos yield 2 favorites.
    await page.getByRole('button', { name: 'Favorites 2' }).click();
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(2);

    // #75: thumbs decrypt over overlook-thumb:// straight into <img> — the
    // seeded thumb decodes (naturalWidth > 0), a missing id errors so the
    // renderer keeps its placeholder. String-form evaluate: the tests
    // project has no DOM lib.
    const thumb = await page.evaluate<{ ok: boolean; width: number }>(`new Promise((resolve) => {
      const el = new Image();
      el.onload = () => resolve({ ok: true, width: el.naturalWidth });
      el.onerror = () => resolve({ ok: false, width: 0 });
      el.src = 'overlook-thumb://library/01J8SEEDPHOTO0000?size=thumb';
    })`);
    expect(thumb).toEqual({ ok: true, width: 1 });
    const missing = await page.evaluate<boolean>(`new Promise((resolve) => {
      const el = new Image();
      el.onload = () => resolve(true);
      el.onerror = () => resolve(false);
      el.src = 'overlook-thumb://library/01J8DOESNOTEXIST?size=thumb';
    })`);
    expect(missing).toBe(false);

    // #77: grid/list toggle — rows render, the zoom slider hides (not
    // disables), and the id-based selection survives the round-trip.
    await page.getByRole('button', { name: 'All Photos 12' }).click();
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(12);
    await page.locator('.ovl-tile__select').first().click();
    await expect(page.locator('.ovl-tile--selected')).toHaveCount(1);
    await page.getByRole('radio', { name: 'List' }).click();
    await expect(page.locator('.ovl-listrow')).toHaveCount(12);
    // #79: visibility-hidden per the mock — layout holds, control unusable.
    await expect(page.getByRole('slider', { name: 'Zoom' })).toBeHidden();
    await expect(page.locator('.ovl-listrow--selected')).toHaveCount(1);
    await page.getByRole('radio', { name: 'Grid' }).click();
    await expect(page.locator('.ovl-tile--selected')).toHaveCount(1);
    await expect(page.getByRole('slider', { name: 'Zoom' })).toBeVisible();

    // #78: select-all (visible set) shows the pill; the selection survives a
    // source switch only for still-visible photos (12 selected → 2 in
    // Favorites); clear-× empties it.
    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.getByTestId('selection-pill')).toContainText('12 SELECTED');
    await page.getByRole('button', { name: 'Favorites 2' }).click();
    await expect(page.getByTestId('selection-pill')).toContainText('2 SELECTED');
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await expect(page.getByTestId('selection-pill')).toHaveCount(0);
    await page.getByRole('button', { name: 'All Photos 12' }).click();
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(12);

    // #79: search + chips filter the seeded library live (E4.7 semantics).
    const search = page.getByRole('searchbox', { name: 'Search library' });
    await search.fill('lisbon');
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(2);
    await search.fill('zzz-no-match');
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await search.fill('');
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(12);

    await page.getByRole('button', { name: 'Filters' }).click();
    await expect(page.getByTestId('chip-row')).toContainText('SEMANTIC SEARCH — COMING SOON');
    await page.getByRole('button', { name: 'RAW' }).click();
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(3);
    await page.getByRole('button', { name: 'RAW' }).click();
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(12);

    // #79: the seed leaves 4 dirty ledger rows, so backup starts enabled;
    // the action itself is the M08 stub toast.
    const backup = page.getByRole('button', { name: 'Back up' });
    await expect(backup).toBeEnabled();
    await backup.click();
    await expect(page.getByText('BACKUP LANDS WITH M08')).toBeVisible();
  } finally {
    await app.close();
  }
});
