import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const ALBUM_PASSWORD = 'Private Album Password 42!';
const CHANGED_PASSWORD = 'Changed Private Password 73!';
const RECOVERED_PASSWORD = 'Recovered Private Password 84!';
const RECOVERY_PASSWORD = 'Recovery Key Password 95!';
const APP_PASSWORD = 'Whole App Password 26!';

function launch(userData: string, keyFile: string, seed = false): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_INSECURE_KEYSTORE: '1',
      OVERLOOK_KEY_EXPORT_DESTINATION: keyFile,
      OVERLOOK_KEY_IMPORT_SOURCE: keyFile,
      ...(seed ? { OVERLOOK_SEED: '4' } : {}),
    },
  });
}

async function openPrivacy(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Privacy' }).click();
}

async function exportRecoveryKey(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Back up…' }).click();
  await page.getByLabel('New password').fill(RECOVERY_PASSWORD);
  await page.getByLabel('Re-enter password').fill(RECOVERY_PASSWORD);
  await page.getByText('I understand this password cannot be reset or recovered.').click();
  await page.getByRole('button', { name: 'Export key backup' }).click();
  await expect(page.getByText('Key backup saved.')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
}

async function createPrivateAlbum(page: Page): Promise<readonly string[]> {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'New album' }).click();
  await page.getByRole('textbox', { name: 'Album name' }).fill('Private originals');
  await page.getByRole('textbox', { name: 'Album name' }).press('Enter');
  return page.evaluate<readonly string[]>(`(async () => {
    const { photos } = await window.overlook.library.page({ source: 'all', limit: 10 });
    const { albums } = await window.overlook.library.albums();
    const album = albums.find((candidate) => candidate.name === 'Private originals');
    await window.overlook.albums.addPhotos({ albumId: album.id, photoIds: photos.slice(0, 2).map((photo) => photo.id) });
    return photos.slice(0, 2).map((photo) => photo.fileName);
  })()`);
}

async function protectAlbum(page: Page): Promise<void> {
  await openPrivacy(page);
  const row = page.locator('.ovl-protected-settings__row', { hasText: 'Private originals' });
  await row.getByRole('button', { name: 'Protect…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Protect “Private originals”' });
  await dialog.getByLabel('New protected album password').fill(ALBUM_PASSWORD);
  await dialog.getByLabel('Confirm protected album password').fill(ALBUM_PASSWORD);
  await dialog.getByRole('button', { name: 'Protect album' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Unlock…' })).toBeVisible();
  await page.keyboard.press('Escape');
}

async function lockedAlbumId(page: Page): Promise<string> {
  return page.evaluate<string>(`window.overlook.protectedAlbums.list().then(({ albums }) => albums[0].id)`);
}

async function assertLockedWithoutLeak(page: Page, protectedNames: readonly string[]): Promise<void> {
  const lockedRow = page.getByRole('button', { name: 'Protected album', exact: true });
  await expect(lockedRow).toBeVisible();
  await expect(page.getByText('Private originals', { exact: true })).toHaveCount(0);
  for (const name of protectedNames) {
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('img', { name })).toHaveCount(0);
  }
  const stats = await page.evaluate<{ photos: number }>('window.overlook.library.stats()');
  expect(stats.photos).toBe(2);
  const albums = await page.evaluate<{ albums: readonly { name: string }[] }>('window.overlook.library.albums()');
  expect(albums.albums.some((album) => album.name === 'Private originals')).toBe(false);
  const albumId = await lockedAlbumId(page);
  const result = await page.evaluate<string>(
    `(async (id) => {
      try { await window.overlook.protectedAlbums.summary({ albumId: id }); return 'exposed'; }
      catch (error) { return String(error); }
    })`,
    albumId,
  );
  expect(result).not.toBe('exposed');
}

async function unlockProtected(page: Page, password: string): Promise<void> {
  const origin = page.getByRole('button', { name: 'Protected album', exact: true });
  await origin.focus();
  await origin.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Unlock protected album' });
  await expect(dialog.getByLabel('Protected album password')).toBeFocused();
  await dialog.getByLabel('Protected album password').fill(password);
  await dialog.getByLabel('Protected album password').press('Enter');
  await expect(page.getByRole('heading', { name: 'Private originals' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.ovl-protected-route .ovl-grid__cell')).toHaveCount(2);
}

async function changeAlbumPassword(page: Page): Promise<void> {
  await openPrivacy(page);
  await page.getByRole('button', { name: 'Change…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change protected album password' });
  await dialog.getByLabel('Current protected album password').fill(ALBUM_PASSWORD);
  await dialog.getByLabel('New protected album password').fill(CHANGED_PASSWORD);
  await dialog.getByLabel('Confirm protected album password').fill(CHANGED_PASSWORD);
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Unlock…' })).toBeVisible();
  await page.keyboard.press('Escape');
}

async function recoverAlbumPassword(page: Page): Promise<void> {
  await openPrivacy(page);
  await page.getByRole('button', { name: 'Recover…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Recover protected album' });
  await dialog.getByRole('button', { name: 'Choose…' }).click();
  await expect(dialog).toContainText('overlook-recovery.key');
  await dialog.getByLabel('Recovery file password').fill(RECOVERY_PASSWORD);
  await dialog.getByLabel('New protected album password').fill(RECOVERED_PASSWORD);
  await dialog.getByLabel('Confirm protected album password').fill(RECOVERED_PASSWORD);
  await dialog.getByRole('button', { name: 'Recover' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Unlock…' })).toBeVisible();
  await page.keyboard.press('Escape');
}

async function configureAppLock(page: Page): Promise<void> {
  await openPrivacy(page);
  await page.getByRole('button', { name: 'Set password…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set app password' });
  await dialog.getByLabel('New app password').fill(APP_PASSWORD);
  await dialog.getByLabel('Confirm app password').fill(APP_PASSWORD);
  await dialog.getByRole('button', { name: 'Set app password' }).click();
  await expect(page.getByTestId('lock-screen')).toBeVisible();
}

async function unlockApp(page: Page): Promise<void> {
  await page.getByLabel('App password').fill(APP_PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('button', { name: 'Protected album', exact: true })).toBeVisible({ timeout: 30_000 });
}

async function lifecycleLock(app: ElectronApplication, name: 'lock-screen' | 'suspend' | 'user-did-resign-active'): Promise<void> {
  await app.evaluate(({ powerMonitor }, eventName) => powerMonitor.emit(eventName), name);
}

async function removeProtection(page: Page): Promise<void> {
  await openPrivacy(page);
  await page.getByRole('region', { name: 'Protected albums' }).getByRole('button', { name: 'Remove…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove album protection' });
  await dialog.getByLabel('Current protected album password').fill(RECOVERED_PASSWORD);
  await dialog.getByRole('button', { name: 'Remove protection' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.ovl-protected-settings__row', { hasText: 'Private originals' })).toBeVisible();
  await page.keyboard.press('Escape');
}

async function prepareProtectedProfile(userData: string, keyFile: string): Promise<readonly string[]> {
  const app = await launch(userData, keyFile, true);
  try {
    const page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await openPrivacy(page);
    await exportRecoveryKey(page);
    expect(existsSync(keyFile)).toBe(true);
    const protectedNames = await createPrivateAlbum(page);
    await protectAlbum(page);
    await assertLockedWithoutLeak(page, protectedNames);
    return protectedNames;
  } finally {
    await app.close();
  }
}

test('protected albums: no-leak restart, session relock, credential recovery, lifecycle revocation, and removal', async () => {
  test.setTimeout(180_000);
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-protected-'));
  const keyFile = join(mkdtempSync(join(tmpdir(), 'overlook-e2e-protected-key-')), 'overlook-recovery.key');
  const protectedNames = await prepareProtectedProfile(userData, keyFile);

  const second = await launch(userData, keyFile);
  try {
    const page = await second.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await assertLockedWithoutLeak(page, protectedNames);

    await unlockProtected(page, ALBUM_PASSWORD);
    await page.locator('.ovl-protected-route .ovl-grid__cell').first().getByRole('button').focus();
    await page.keyboard.press('Enter');
    const lightbox = page.getByRole('dialog', { name: new RegExp(`Viewing ${protectedNames[0]}`, 'u') });
    await expect(lightbox).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.ovl-protected-route .ovl-grid__cell').first().getByRole('button')).toBeFocused();

    await page.getByRole('button', { name: /All Photos/u }).click();
    await assertLockedWithoutLeak(page, protectedNames);
    await unlockProtected(page, ALBUM_PASSWORD);
    const protectedSrc = await page.locator('.ovl-protected-route img').first().getAttribute('src');
    await page.getByRole('button', { name: 'Relock' }).click();
    await assertLockedWithoutLeak(page, protectedNames);
    expect(protectedSrc).not.toBeNull();
    const staleMedia = await page.evaluate(
      async (src) =>
        fetch(src)
          .then(() => 'loaded')
          .catch(() => 'revoked'),
      protectedSrc as string,
    );
    expect(staleMedia).toBe('revoked');

    await unlockProtected(page, ALBUM_PASSWORD);
    await changeAlbumPassword(page);
    await assertLockedWithoutLeak(page, protectedNames);
    await recoverAlbumPassword(page);
    await unlockProtected(page, RECOVERED_PASSWORD);
    await configureAppLock(page);
    await unlockApp(page);

    for (const event of ['lock-screen', 'suspend', 'user-did-resign-active'] as const) {
      await unlockProtected(page, RECOVERED_PASSWORD);
      await lifecycleLock(second, event);
      await expect(page.getByTestId('lock-screen')).toBeVisible();
      await unlockApp(page);
      await assertLockedWithoutLeak(page, protectedNames);
    }

    await unlockProtected(page, RECOVERED_PASSWORD);
    await removeProtection(page);
    await expect(page.getByRole('button', { name: 'Private originals 2', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Protected album', exact: true })).toHaveCount(0);
    const stats = await page.evaluate<{ photos: number }>('window.overlook.library.stats()');
    expect(stats.photos).toBe(4);
  } finally {
    await second.close();
  }
});
