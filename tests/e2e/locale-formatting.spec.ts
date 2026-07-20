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
    await expect(page.getByTestId('statusbar-left')).toContainText('2.000 PHOTOS ·');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-DE');
  } finally {
    await app.close();
  }
});
