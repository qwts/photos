import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron, type Page } from '@playwright/test';

const PHOTO_ID = '01J8SEEDPHOTO0000';

async function syncState(page: Page): Promise<string> {
  return page.evaluate<string>(`window.overlook.library.get({ id: '${PHOTO_ID}' }).then((result) => result.photo?.syncState ?? '?')`);
}

async function confirmOffload(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Offload originals' });
  await expect(dialog.getByText('1 original')).toBeVisible();
  await expect(dialog.getByText(/ESTIMATED SPACE FREED/u)).toBeVisible();
  await dialog.getByRole('button', { name: 'Offload 1' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => syncState(page)).toBe('offloaded');
}

test('manual offload entry points, responsive controls, Undo, and Settings restore round-trip', async () => {
  test.setTimeout(60_000);
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-offload-ui-'));
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '4',
      OVERLOOK_INSECURE_KEYSTORE: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    const firstCell = page.locator('.ovl-grid__cell').first();
    await page.getByTestId('virtual-grid').waitFor();
    await firstCell.locator('.ovl-tile__img').waitFor();
    await page.getByRole('button', { name: 'Back up' }).click();
    await expect(page.getByTestId('sync-state')).toContainText('ALL BACKED UP · JUST NOW', { timeout: 20_000 });

    // Minimum-width selection layout keeps Offload visible and moves the
    // secondary actions into the keyboard-accessible overflow.
    await page.setViewportSize({ width: 720, height: 640 });
    await firstCell.getByRole('button', { name: 'Select' }).click();
    const pill = page.getByTestId('selection-pill');
    await expect(pill.getByRole('button', { name: 'Offload' })).toBeVisible();
    await expect(pill.getByRole('button', { name: 'More selection actions' })).toBeVisible();
    await expect(pill.getByRole('button', { name: 'Export' })).toBeHidden();

    // Cancel is read-only and preserves the selection.
    await pill.getByRole('button', { name: 'Offload' }).click();
    const dialog = page.getByRole('dialog', { name: 'Offload originals' });
    await expect(dialog.getByText('1 original')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => syncState(page)).toBe('synced');
    await expect(pill).toContainText('1 SELECTED');

    // Selection entry: verified eviction, targeted update, clear-on-success,
    // and Undo's verified download/status restoration.
    await pill.getByRole('button', { name: 'Offload' }).click();
    await confirmOffload(page);
    await expect(pill).toBeHidden();
    await expect(page.getByRole('status')).toContainText('Offloaded 1 · Freed');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => syncState(page)).toBe('synced');
    await expect(page.getByRole('status')).toContainText('Restored 1 original');

    // Context entry executes the same preflight, then Settings restores the
    // selected original and reports the verified result.
    await firstCell.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Offload original…' }).click();
    await confirmOffload(page);
    await firstCell.getByRole('button', { name: 'Select' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    const settings = page.getByTestId('settings-dialog');
    await expect(settings.getByText(/stored only in your verified cloud backup/u)).toBeVisible();
    await settings.getByRole('button', { name: 'Restore selected (1)' }).click();
    await expect(settings.getByText('1 restored')).toBeVisible();
    await expect.poll(() => syncState(page)).toBe('synced');
    await page.keyboard.press('Escape');
    await pill.getByRole('button', { name: 'Clear selection' }).click();
    await expect(page.getByRole('status')).toBeHidden({ timeout: 6000 });

    // Lightbox entry stays open through preflight, then closes after the
    // confirmed offload instead of immediately rehydrating its own photo.
    await firstCell.click();
    const lightbox = page.getByTestId('lightbox');
    await lightbox.getByRole('button', { name: 'Offload original' }).click();
    await expect(lightbox).toBeVisible();
    await confirmOffload(page);
    await expect(lightbox).toBeHidden();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => syncState(page)).toBe('synced');
  } finally {
    await app.close();
  }
});
