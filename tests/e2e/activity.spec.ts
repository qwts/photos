import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

import { mkE2eTmpDir } from './support/tmp-dir.js';

function launch(userData: string, seed = false): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_INSECURE_KEYSTORE: '1',
      ...(seed ? { OVERLOOK_SEED: '3' } : {}),
    },
  });
}

test('ACCEPTANCE: trusted mutations appear in encrypted activity and survive restart (#614)', async () => {
  const userData = mkE2eTmpDir('overlook-e2e-activity-');
  const first = await launch(userData, true);
  try {
    const page = await first.firstWindow();
    await page.locator('.ovl-tile__img').first().waitFor();
    await page.getByRole('button', { name: 'Add to Favorites' }).first().click();
    await expect(page.getByRole('button', { name: 'Remove from Favorites' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Activity' }).click();
    await expect(page.getByRole('dialog', { name: 'Activity' })).toContainText('Changed a favorite');
  } finally {
    await first.close();
  }

  const second = await launch(userData);
  try {
    const page = await second.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await page.getByRole('button', { name: 'Activity' }).click();
    await expect(page.getByRole('dialog', { name: 'Activity' })).toContainText('Changed a favorite');
  } finally {
    await second.close();
  }
});
