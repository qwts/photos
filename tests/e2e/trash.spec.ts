import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';

/** Recursive file count — the mock provider's remote blob tree. */
function fileCount(dir: string): number {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).length;
  } catch {
    return 0;
  }
}

// #120 exit criteria: delete from grid AND lightbox → Recently deleted →
// restore → back with favorite/status intact. Purge lands with #121.
test('soft delete: grid + lightbox routes, trash restore keeps state intact', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-trash-'));
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '3',
      OVERLOOK_INSECURE_KEYSTORE: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await page.locator('.ovl-tile__img').first().waitFor();

    // Favorite photo 1 so restore can prove state survives the round-trip.
    await page.evaluate(`window.overlook.library.toggleFavorite({ id: '01J8SEEDPHOTO0001' })`);

    // Grid route: select tile 1 → pill Delete → toast + counts move.
    await page.locator('.ovl-grid__cell').nth(1).hover();
    await page.locator('.ovl-tile__select').nth(1).click();
    // Scoped to the pill: the "Recently deleted" sidebar row also matches
    // a bare 'Delete' name query.
    await page.getByTestId('selection-pill').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('status')).toContainText('Moved 1 photo to Recently deleted');
    await expect(page.getByRole('button', { name: 'Recently deleted 1' })).toBeVisible();
    await expect(page.locator('.ovl-grid__cell')).toHaveCount(2);

    // Lightbox route: open the first remaining photo, Delete — the row
    // leaves the visible set, which closes the lightbox.
    await page.locator('.ovl-grid__cell').first().click();
    await expect(page.getByTestId('lightbox')).toBeVisible();
    await page.getByTestId('lightbox').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('lightbox')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Recently deleted 2' })).toBeVisible();

    // Trash shows both; the pill flips to Restore + the destructive Delete
    // (#121's purge ceremony — no Export here).
    await page.getByRole('button', { name: 'Recently deleted 2' }).click();
    // Wait for REAL tiles, not placeholder cells — ⌘A reads loaded photos
    // (the #189 cold-start rule applies to source switches too).
    await expect(page.locator('.ovl-tile__img')).toHaveCount(2);
    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.getByTestId('selection-pill')).toContainText('2 SELECTED');
    await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
    await expect(page.getByTestId('selection-pill').getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect(page.getByTestId('selection-pill').getByRole('button', { name: 'Export' })).toHaveCount(0);

    // The in-trash lightbox offers no Delete either (PR #218 review) —
    // an already-deleted row's action is Restore, purge is #121.
    await page.locator('.ovl-grid__cell').first().click();
    await expect(page.getByTestId('lightbox')).toBeVisible();
    await expect(page.getByTestId('lightbox').getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('lightbox')).not.toBeVisible();

    // Restore both: favorite came back intact, trash empties.
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByRole('status')).toContainText('Restored 2 photos');
    await page.getByRole('button', { name: /All Photos/u }).click();
    await expect(page.locator('.ovl-grid__cell')).toHaveCount(3);
    const favorite = await page.evaluate<boolean>(
      `window.overlook.library.get({ id: '01J8SEEDPHOTO0001' }).then((r) => r.photo?.favorite ?? false)`,
    );
    expect(favorite).toBe(true);
    await expect(page.getByRole('button', { name: 'Recently deleted 0' })).toBeVisible();
  } finally {
    await app.close();
  }
});

// #121 exit criteria: purge removes all three copies under the mock
// provider — destructive confirm with exact counts and "Delete" language.
test('purge: confirm ceremony removes DB row, local blob, and remote copy', async () => {
  // A full backup precedes the purge — under parallel-suite load 30s is
  // too tight (the earlier backup-spec CI flake was this same class).
  test.setTimeout(60_000);
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-purge-'));
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '3',
      OVERLOOK_INSECURE_KEYSTORE: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await page.locator('.ovl-tile__img').first().waitFor();

    // Back up, then target a photo whose blob VERIFIABLY reached the
    // remote (seed profiles settle some rows without uploading them).
    await page.getByRole('button', { name: 'Back up' }).click();
    await expect(page.getByTestId('sync-state')).toContainText('ALL BACKED UP', { timeout: 20_000 });
    const remoteBlobs = join(userData, 'mock-remote', 'blobs');
    const photos = await page.evaluate<{ id: string; contentHash: string; fileName: string }[]>(
      `window.overlook.library.page({ source: 'all', limit: 10 }).then((r) => r.photos.map((p) => ({ id: p.id, contentHash: p.contentHash, fileName: p.fileName })))`,
    );
    const remotePath = (hash: string): string => join(remoteBlobs, hash.slice(0, 2), hash);
    const target = photos.find((photo) => existsSync(remotePath(photo.contentHash)));
    expect(target).toBeDefined();
    const before = fileCount(remoteBlobs);
    expect(before).toBeGreaterThan(0);

    await page.evaluate(`window.overlook.library.delete({ photoIds: ['${target?.id ?? ''}'] })`);
    await page.getByRole('button', { name: 'Recently deleted 1' }).click();
    // Gate ⌘A on the TRASH page having actually landed in state — a lone
    // tile can also match a half-decoded previous source under load, and
    // select-all reads state.photos (the "Delete 2 photos" screenshot).
    await expect(page.locator('.ovl-tile__img')).toHaveCount(1);
    await expect(page.locator('.ovl-tile__img').first()).toHaveAttribute('alt', target?.fileName ?? '');
    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.getByTestId('selection-pill')).toContainText('1 SELECTED');

    // The ceremony: red Delete in the pill → confirm dialog with the exact
    // count → the destructive button.
    await page.getByTestId('selection-pill').getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete photos' });
    await expect(confirm).toContainText('This can’t be undone.');
    await confirm.getByRole('button', { name: 'Delete 1 photo' }).click();
    await expect(page.getByRole('status')).toContainText('Deleted 1 photo');

    // All three copies are gone; the library keeps browsing.
    await expect(page.getByRole('button', { name: 'Recently deleted 0' })).toBeVisible();
    expect(fileCount(remoteBlobs)).toBe(before - 1);
    expect(existsSync(remotePath(target?.contentHash ?? ''))).toBe(false);
    const stillListed = await page.evaluate<boolean>(
      `window.overlook.library.get({ id: '${target?.id ?? ''}' }).then((r) => r.photo !== null)`,
    );
    expect(stillListed).toBe(false);
    await page.getByRole('button', { name: /All Photos/u }).click();
    await expect(page.locator('.ovl-tile__img')).toHaveCount(2);
  } finally {
    await app.close();
  }
});
