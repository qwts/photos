import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

import { mkE2eTmpDir } from './support/tmp-dir.js';

// Activity is a Help affordance now (#690) — never a sidebar row. It opens from
// the macOS native Help menu, and on Windows/Linux (no native menu, #699) from
// the titlebar Help menu, so exercise whichever surface the platform ships.
async function openActivity(app: ElectronApplication, page: Page): Promise<void> {
  if (process.platform === 'darwin') {
    await app.evaluate(({ BrowserWindow, Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('help.activity');
      if (item?.click === undefined) throw new Error('menu item unavailable: help.activity');
      Reflect.apply(item.click, item, [
        item,
        BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0],
        { triggeredByAccelerator: false },
      ]);
    });
    return;
  }
  await page.getByRole('button', { name: 'Help' }).click();
  await page.getByRole('menuitem', { name: 'Activity…' }).click();
}

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

test('ACCEPTANCE: activity and capability-aware Undo/Redo survive restart (#614, #615)', async () => {
  const userData = mkE2eTmpDir('overlook-e2e-activity-');
  const first = await launch(userData, true);
  try {
    const page = await first.firstWindow();
    await page.locator('.ovl-tile__img').first().waitFor();
    await page.getByRole('button', { name: 'Add to Favorites' }).first().click();
    await expect(page.getByRole('button', { name: 'Remove from Favorites' }).first()).toBeVisible();
    await openActivity(first, page);
    const dialog = page.getByRole('dialog', { name: 'Activity' });
    await expect(dialog).toContainText('Changed a favorite');
    await dialog.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: 'Add to Favorites' }).first()).toBeVisible();
  } finally {
    await first.close();
  }

  const second = await launch(userData);
  try {
    const page = await second.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await openActivity(second, page);
    const dialog = page.getByRole('dialog', { name: 'Activity' });
    await expect(dialog).toContainText('Undid an action');
    await dialog.getByRole('button', { name: 'Redo' }).click();
    await expect(page.getByRole('button', { name: 'Remove from Favorites' }).first()).toBeVisible();
  } finally {
    await second.close();
  }
});
