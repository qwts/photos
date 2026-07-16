import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

async function launchSeeded(): Promise<{ app: ElectronApplication; page: Page }> {
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-interop-'));
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '4',
      OVERLOOK_INSECURE_KEYSTORE: '1',
    },
  });
  const page = await app.firstWindow();
  await page.getByTestId('virtual-grid').waitFor();
  await page.locator('.ovl-tile__img').first().waitFor();
  return { app, page };
}

test('selection opens an honest blocked transfer review without changing selection or view', async () => {
  const { app, page } = await launchSeeded();
  try {
    await page.locator('.ovl-tile__select').first().click();
    const selection = page.getByTestId('selection-pill');
    await selection.getByRole('button', { name: 'Transfer & Sync' }).click();

    const dialog = page.getByRole('dialog', { name: 'Move to Image Trail' });
    await expect(dialog).toContainText('SELECTION · QUEUED');
    await expect(dialog).toContainText('No interop provider');
    await expect(dialog).toContainText('0 / 1 · 0 acknowledged · 0 finalized');
    await expect(dialog.getByRole('button', { name: 'Start move' })).toBeDisabled();

    await dialog.locator('.ovl-dialog__footer').getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await expect(selection).toContainText('1 SELECTED');
    await expect(page.getByRole('radio', { name: 'Grid' })).toBeChecked();
  } finally {
    await app.close();
  }
});

test('Settings and lightbox entries preserve their underlying surfaces', async () => {
  const { app, page } = await launchSeeded();
  try {
    await page.getByRole('button', { name: 'Settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Transfer & Sync' }).click();
    await settings.getByRole('button', { name: 'Open Transfer & Sync' }).click();

    const settingsTransfer = page.getByRole('dialog', { name: 'Move to Image Trail' });
    await expect(settingsTransfer).toContainText('SETTINGS · QUEUED');
    await settingsTransfer.locator('.ovl-dialog__footer').getByRole('button', { name: 'Close' }).click();
    await expect(settings).toBeVisible();
    await page.keyboard.press('Escape');

    await page.locator('.ovl-grid__cell').first().click();
    const lightbox = page.getByTestId('lightbox');
    await lightbox.getByRole('button', { name: 'Transfer & Sync' }).click();
    const lightboxTransfer = page.getByRole('dialog', { name: 'Move to Image Trail' });
    await expect(lightboxTransfer).toContainText('LIGHTBOX · QUEUED');
    await lightboxTransfer.locator('.ovl-dialog__footer').getByRole('button', { name: 'Close' }).click();
    await expect(lightbox).toBeVisible();
  } finally {
    await app.close();
  }
});

test('album actions open an album-scoped transfer review and preserve the active source', async () => {
  const { app, page } = await launchSeeded();
  try {
    const albumRow = page.locator('.ovl-sidebar__albumrow', { hasText: 'Travel 2026' });
    const albumSource = albumRow.locator(':scope > .ovl-siderow');
    await albumSource.click();
    await albumRow.hover();
    await page.getByRole('button', { name: 'Actions for Travel 2026' }).click();
    await page.getByRole('menuitem', { name: 'Transfer & Sync…' }).click();

    const dialog = page.getByRole('dialog', { name: 'Move to Image Trail' });
    await expect(dialog).toContainText('ALBUM · QUEUED');
    await expect(dialog).toContainText('0 / 1 · 0 acknowledged · 0 finalized');
    await dialog.locator('.ovl-dialog__footer').getByRole('button', { name: 'Close' }).click();
    await expect(albumSource).toHaveClass(/ovl-siderow--active/u);
    await expect(page.locator('.ovl-grid__cell')).toHaveCount(1);
  } finally {
    await app.close();
  }
});
