import { cpSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import type { OverlookApi } from '../../src/shared/ipc/api.js';

const PASSWORD = 'correct horse battery staple';
const PHOTO_COUNT = 4;

function launch(userData: string, extra: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_INSECURE_KEYSTORE: '1',
      ...extra,
    },
  });
}

test('fresh profile: wrong password is non-destructive; cancel resumes; validated cloud library activates (#290)', async () => {
  const source = mkdtempSync(join(tmpdir(), 'overlook-e2e-restore-source-'));
  const target = mkdtempSync(join(tmpdir(), 'overlook-e2e-restore-target-'));
  const keyPath = join(mkdtempSync(join(tmpdir(), 'overlook-e2e-restore-key-')), 'overlook-recovery.key');

  const sourceApp = await launch(source, { OVERLOOK_SEED: String(PHOTO_COUNT), OVERLOOK_KEY_EXPORT_DESTINATION: keyPath });
  try {
    const page = await sourceApp.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await page.evaluate(async () => {
      const api = (globalThis as unknown as { overlook: OverlookApi }).overlook;
      const { photos } = await api.library.page({ source: 'all', limit: 100 });
      for (const photo of photos) await api.library.toggleFavorite({ id: photo.id });
    });
    const exported = await page.evaluate(
      (password) => (globalThis as unknown as { overlook: OverlookApi }).overlook.keys.export({ password }),
      PASSWORD,
    );
    expect(exported.path).toBe(keyPath);
    const backup = await page.evaluate(() => (globalThis as unknown as { overlook: OverlookApi }).overlook.backup.run({}));
    expect(backup).toMatchObject({ failed: 0, skipped: null });
    await expect
      .poll(() => page.evaluate(() => (globalThis as unknown as { overlook: OverlookApi }).overlook.library.stats()).then((s) => s.pending))
      .toBe(0);
  } finally {
    await sourceApp.close();
  }

  cpSync(join(source, 'mock-remote'), join(target, 'mock-remote'), { recursive: true });
  const targetApp = await launch(target, {
    OVERLOOK_KEY_IMPORT_SOURCE: keyPath,
    OVERLOOK_RESTORE_NO_RELAUNCH: '1',
  });
  try {
    const page = await targetApp.firstWindow();
    await expect(page.getByTestId('restore-onboarding')).toBeVisible();
    await page.getByRole('button', { name: 'Choose recovery key' }).click();
    await page.getByLabel('Recovery-key password').fill('wrong password');
    await page.getByRole('button', { name: 'Discover backups' }).click();
    await expect(page.getByRole('alert')).toContainText('password is incorrect');
    expect(existsSync(join(target, 'library', 'library.db'))).toBe(false);

    await page.getByLabel('Recovery-key password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Discover backups' }).click();
    await expect(page.getByTestId('restore-library-card')).toContainText(`${String(PHOTO_COUNT)} PHOTOS`);
    await page.getByRole('button', { name: 'Review restore' }).click();
    await page.getByRole('button', { name: `Restore ${String(PHOTO_COUNT)} photos` }).click();
    await expect(page.getByRole('button', { name: 'Cancel and keep staged progress' })).toBeVisible();
    await page.evaluate(() => (globalThis as unknown as { overlook: OverlookApi }).overlook.restore.cancel({}));
    await expect(page.getByRole('alert')).toContainText('Restore paused');
    expect(existsSync(join(target, 'library', 'library.db'))).toBe(false);

    await page.getByRole('button', { name: `Restore ${String(PHOTO_COUNT)} photos` }).click();
    await expect(page.getByText('Restore complete')).toBeVisible({ timeout: 30_000 });
    expect(existsSync(join(target, 'library', 'library.db'))).toBe(true);
  } finally {
    await targetApp.close();
  }

  const relaunched = await launch(target);
  try {
    const page = await relaunched.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await expect(page.getByTestId('statusbar-left')).toContainText(`${String(PHOTO_COUNT)} PHOTOS`);
    await expect(page.getByTestId('restore-onboarding')).not.toBeVisible();
  } finally {
    await relaunched.close();
  }
});
