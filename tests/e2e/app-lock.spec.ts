import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const PASSWORD = 'Correct Horse Battery Staple 42!';
const NEXT_PASSWORD = 'Different Excellent Password 73!';

function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '2',
      OVERLOOK_INSECURE_KEYSTORE: '1',
      OVERLOOK_APP_LOCK_TEST_ANCHOR: '1',
    },
  });
}

async function unlock(page: Page, password: string): Promise<void> {
  await page.getByLabel('App password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByTestId('virtual-grid').waitFor();
}

async function emitLifecycleLock(app: ElectronApplication, event: 'lock-screen' | 'suspend' | 'user-did-resign-active'): Promise<void> {
  await app.evaluate(({ powerMonitor }, name) => {
    powerMonitor.emit(name);
  }, event);
}

test('app lock withholds content across configuration, bypass attempts, restart, rotation, and removal', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-app-lock-'));
  const first = await launch(userData);
  try {
    const page = await first.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    const thumbUrl = await page.locator('.ovl-tile__img').first().getAttribute('src');
    expect(thumbUrl).not.toBeNull();

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Privacy' }).click();
    await page.getByRole('button', { name: 'Set password…' }).click();
    const setDialog = page.getByRole('dialog', { name: 'Set app password' });
    await setDialog.getByLabel('New app password').fill(PASSWORD);
    await setDialog.getByLabel('Confirm app password').fill(PASSWORD);
    await setDialog.getByRole('button', { name: 'Set app password' }).click();

    await expect(page.getByTestId('lock-screen')).toBeVisible();
    await expect(page.getByTestId('virtual-grid')).toHaveCount(0);
    const ipcBypasses = await page.evaluate<string[]>(`(async () => {
      const attempt = async (operation) => {
        try {
          await operation();
          return 'allowed';
        } catch (error) {
          return String(error);
        }
      };
      return Promise.all([
        attempt(() => window.overlook.library.stats()),
        attempt(() => window.overlook.backup.run({})),
        attempt(() => window.overlook.export.pickDestination({})),
        attempt(() => window.overlook.settings.get()),
      ]);
    })()`);
    expect(ipcBypasses).toHaveLength(4);
    for (const result of ipcBypasses) expect(result).not.toBe('allowed');
    const protocolStatus = await page.evaluate(async (url) => {
      try {
        return (await fetch(url)).status;
      } catch {
        return 0;
      }
    }, thumbUrl as string);
    expect(protocolStatus).not.toBe(200);
  } finally {
    await first.close();
  }

  const second = await launch(userData);
  try {
    const page = await second.firstWindow();
    await expect(page.getByTestId('lock-screen')).toBeVisible();
    await expect(page.getByTestId('virtual-grid')).toHaveCount(0);

    await page.getByLabel('App password').fill('wrong password');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('status')).toContainText('did not unlock');
    await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible({ timeout: 3_000 });
    await page.getByLabel('App password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.getByTestId('virtual-grid').waitFor();

    for (const event of ['lock-screen', 'suspend', 'user-did-resign-active'] as const) {
      await emitLifecycleLock(second, event);
      await expect(page.getByTestId('lock-screen')).toBeVisible();
      await unlock(page, PASSWORD);
    }

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Privacy' }).click();
    await page.getByRole('button', { name: 'Change…' }).click();
    const changeDialog = page.getByRole('dialog', { name: 'Change app password' });
    await changeDialog.getByLabel('Current app password').fill('wrong password');
    await changeDialog.getByLabel('New app password').fill(NEXT_PASSWORD);
    await changeDialog.getByLabel('Confirm app password').fill(NEXT_PASSWORD);
    await changeDialog.getByRole('button', { name: 'Change app password' }).click();
    await expect(changeDialog.getByRole('status')).toContainText('incorrect');
    await changeDialog.getByLabel('Current app password').fill(PASSWORD);
    await changeDialog.getByRole('button', { name: 'Change app password' }).click();
    await expect(changeDialog).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Lock now' }).click();
    await expect(page.getByTestId('lock-screen')).toBeVisible();
    await page.getByLabel('App password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('status')).toContainText('did not unlock');
    await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible({ timeout: 3_000 });
    await page.getByLabel('App password').fill(NEXT_PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.getByTestId('virtual-grid').waitFor();

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Privacy' }).click();
    await page.getByRole('button', { name: 'Remove…' }).click();
    const removeDialog = page.getByRole('dialog', { name: 'Remove app password' });
    await removeDialog.getByLabel('Current app password').fill(NEXT_PASSWORD);
    await removeDialog.getByRole('button', { name: 'Remove app password' }).click();
    await expect(removeDialog).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Lock now' })).toHaveCount(0);
  } finally {
    await second.close();
  }
});
