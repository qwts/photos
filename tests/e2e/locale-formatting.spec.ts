import { test, expect, _electron as electron } from '@playwright/test';

import { mkE2eTmpDir } from './support/tmp-dir.js';

test('composed chrome formats values with the main-resolved locale', async () => {
  const userData = mkE2eTmpDir('overlook-e2e-locale-');
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED_SYNTHETIC: '2000',
      OVERLOOK_INSECURE_KEYSTORE: '1',
      OVERLOOK_LOCALE: 'en-DE',
    },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId('virtual-grid')).toBeVisible();
    await expect(page.getByTestId('statusbar-left')).toContainText('2.000 photos ·');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-DE');
  } finally {
    await app.close();
  }
});

test('language setting applies live and propagates RTL direction without restart', async () => {
  const userData = mkE2eTmpDir('overlook-e2e-language-');
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '2',
      OVERLOOK_INSECURE_KEYSTORE: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId('virtual-grid')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    await page.evaluate(`window.overlook.settings.set({ patch: { language: 'en-XB' } })`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-XB');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('button', { name: /⟪.*⟫/u }).first()).toBeVisible();
    const tilePositions = await page
      .locator('.ovl-grid__cell')
      .evaluateAll((tiles) =>
        tiles
          .slice(0, 2)
          .map((tile) => (tile as unknown as { getBoundingClientRect(): { readonly left: number } }).getBoundingClientRect().left),
      );
    expect(tilePositions[0]).toBeGreaterThan(tilePositions[1] ?? Number.POSITIVE_INFINITY);

    await page.evaluate(`window.overlook.settings.set({ patch: { language: 'en' } })`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  } finally {
    await app.close();
  }
});
