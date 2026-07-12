import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

import type { OverlookApi } from '../../src/shared/ipc/api.js';

// M04 acceptance flows (#82) against the deterministic seeded profile —
// each flow is its own test so a regression names the broken flow, not a
// 100-line composite. Ledger: tests/e2e/coverage-map.json.

async function launchSeeded(): Promise<{ app: ElectronApplication; page: Page }> {
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-browse-'));
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '12',
      OVERLOOK_INSECURE_KEYSTORE: '1',
    },
  });
  const page = await app.firstWindow();
  await page.getByTestId('virtual-grid').waitFor();
  return { app, page };
}

test('browse + zoom: tiles render thumbs and rescale with the slider', async () => {
  const { app, page } = await launchSeeded();
  try {
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(12);
    await expect(page.locator('.ovl-tile__img').first()).toHaveJSProperty('naturalWidth', 1);

    const before = await page.locator('.ovl-grid__cell').first().boundingBox();
    await page.getByRole('slider', { name: 'Zoom' }).fill('320');
    await expect(async () => {
      const after = await page.locator('.ovl-grid__cell').first().boundingBox();
      expect((after?.width ?? 0) > (before?.width ?? 0)).toBe(true);
    }).toPass({ timeout: 5000 });
  } finally {
    await app.close();
  }
});

test('grid↔list toggle preserves selection; slider hides in list', async () => {
  const { app, page } = await launchSeeded();
  try {
    await page.locator('.ovl-tile__select').first().click();
    await expect(page.locator('.ovl-tile--selected')).toHaveCount(1);
    await page.getByRole('radio', { name: 'List' }).click();
    await expect(page.locator('.ovl-listrow')).toHaveCount(12);
    await expect(page.getByRole('slider', { name: 'Zoom' })).toBeHidden();
    await expect(page.locator('.ovl-listrow--selected')).toHaveCount(1);
    await page.getByRole('radio', { name: 'Grid' }).click();
    await expect(page.locator('.ovl-tile--selected')).toHaveCount(1);
    await expect(page.getByRole('slider', { name: 'Zoom' })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('search + chips filter the library live; impossible filter shows the empty state', async () => {
  const { app, page } = await launchSeeded();
  try {
    const grid = page.getByTestId('virtual-grid');
    const search = page.getByRole('searchbox', { name: 'Search library' });
    await search.fill('lisbon');
    await expect(grid.locator('.ovl-grid__cell')).toHaveCount(2);
    await search.fill('zzz-no-match');
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await search.fill('');
    await expect(grid.locator('.ovl-grid__cell')).toHaveCount(12);

    await page.getByRole('button', { name: 'Filters' }).click();
    await expect(page.getByTestId('chip-row')).toContainText('SEMANTIC SEARCH — COMING SOON');
    await page.getByRole('button', { name: 'RAW' }).click();
    await expect(grid.locator('.ovl-grid__cell')).toHaveCount(3);
    await page.getByRole('button', { name: 'RAW' }).click();
    await expect(grid.locator('.ovl-grid__cell')).toHaveCount(12);
  } finally {
    await app.close();
  }
});

test('selection: pointer, ⌘/Ctrl+A, Esc, pill survival across sources', async () => {
  const { app, page } = await launchSeeded();
  try {
    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.getByTestId('selection-pill')).toContainText('12 SELECTED');
    // Mock survival semantics: only still-visible photos stay selected.
    await page.getByRole('button', { name: 'Favorites 2' }).click();
    await expect(page.getByTestId('selection-pill')).toContainText('2 SELECTED');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('selection-pill')).toHaveCount(0);
    // Clear-× path too.
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await expect(page.getByTestId('selection-pill')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('sidebar: source switching refilters; counts live-update on mutation', async () => {
  const { app, page } = await launchSeeded();
  try {
    const grid = page.getByTestId('virtual-grid');
    await page.getByRole('button', { name: 'Favorites 2' }).click();
    await expect(grid.locator('.ovl-grid__cell')).toHaveCount(2);
    await page.getByRole('button', { name: 'All Photos 12' }).click();
    await expect(grid.locator('.ovl-grid__cell')).toHaveCount(12);
    await expect(page.getByRole('button', { name: 'Travel 2026 3' })).toBeDisabled();

    await page.evaluate(async () => {
      // type-coverage:ignore-next-line
      const overlook = (globalThis as unknown as { overlook: OverlookApi }).overlook;
      await overlook.library.toggleFavorite({ id: '01J8SEEDPHOTO0001' });
    });
    await expect(page.getByRole('button', { name: 'Favorites 3' })).toBeVisible();

    // PR #167/#169 review: the VISIBLE page refreshes on mutation too —
    // while viewing Favorites, un-favoriting drops the row, not just the
    // sidebar count.
    await page.getByRole('button', { name: 'Favorites 3' }).click();
    await expect(grid.locator('.ovl-grid__cell')).toHaveCount(3);
    await page.evaluate(async () => {
      // type-coverage:ignore-next-line
      const overlook = (globalThis as unknown as { overlook: OverlookApi }).overlook;
      await overlook.library.toggleFavorite({ id: '01J8SEEDPHOTO0001' });
    });
    await expect(grid.locator('.ovl-grid__cell')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Favorites 2' })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('chrome truth: statusbar, backup button and card reflect pending state', async () => {
  const { app, page } = await launchSeeded();
  try {
    await expect(page.getByTestId('statusbar-left')).toContainText('12 PHOTOS ·');
    await expect(page.getByTestId('sync-state')).toContainText('ENCRYPTING 4 → PCLOUD');
    await expect(page.getByTestId('backup-card')).toContainText('Library encrypted');
    await expect(page.getByTestId('backup-card')).toContainText('0 / 4');
    const backup = page.getByRole('button', { name: 'Back up' });
    await expect(backup).toBeEnabled();
    await backup.click();
    await expect(page.getByText('BACKUP LANDS WITH M08')).toBeVisible();
  } finally {
    await app.close();
  }
});
