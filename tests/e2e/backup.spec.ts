import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';

import { mkE2eTmpDir } from './support/tmp-dir.js';

function remoteBlobFiles(userData: string): string[] {
  const root = join(userData, 'mock-remote', 'blobs');
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

// #108 exit criteria (amended by #266): the full visual choreography of a
// mock-provider backup run — amber → green flip, live counts, "JUST NOW"
// reset, and the button LEAVING at pendingCount 0 (an idle affordance
// misstates that there is work; it returns when a change dirties a row).
test('backup choreography: amber → green, JUST NOW reset, button hides at 0', async () => {
  const userData = mkE2eTmpDir('overlook-e2e-backup-');
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
    await page.getByTestId('virtual-grid').waitFor();
    await page.locator('.ovl-tile__img').first().waitFor();

    // Seed 4 starts with one born-dirty local row: amber state, live count,
    // enabled button, storage split on the card.
    await expect(page.getByTestId('sync-state')).toContainText('ENCRYPTING 1 → LOCAL MOCK');
    const backupButton = page.getByRole('button', { name: 'Back up' });
    await expect(backupButton).toBeEnabled();
    await expect(page.getByTestId('backup-card')).toContainText('ON DISK');
    await expect(page.getByTestId('backup-card')).toContainText('0 B OFFLOAD (LOCAL MOCK)');

    // Trigger: the mock's toast pair around the run…
    await backupButton.click();
    await expect(page.getByRole('status')).toContainText('BACKUP COMPLETE', { timeout: 20_000 });

    // …then the green flip with the freshly stamped label…
    await expect(page.getByTestId('sync-state')).toContainText('ALL BACKED UP · JUST NOW');
    // …and the button leaves at pendingCount 0 (#266)…
    await expect(backupButton).toBeHidden();
    // …returning the moment an edit creates work again…
    await page.locator('.ovl-grid__cell').nth(1).click();
    await page.getByTestId('lightbox').getByRole('button', { name: 'Favorite' }).click();
    await page.keyboard.press('Escape');
    await expect(backupButton).toBeVisible();

    // …and with auto-backup on (the default), the edit drains ITSELF: the
    // debounced trigger (#267) runs quietly — no manual click — and the
    // indicator + button leave together. Before #267 this sat at
    // "ENCRYPTING 1 → LOCAL MOCK" forever.
    await expect(page.getByTestId('sync-state')).toContainText('ALL BACKED UP', { timeout: 20_000 });
    await expect(backupButton).toBeHidden();
  } finally {
    await app.close();
  }
});

// #295 regression: backup status changes are not structural invalidations.
// Keep two deep-page UI anchors alive while hundreds of dirty rows settle.
test('large backup preserves deep selection and an open lightbox', async () => {
  // Seeding 504 real encrypted photos is intentionally heavier than ordinary
  // E2E startup and competes with two other Electron workers in CI.
  test.setTimeout(120_000);
  const userData = mkE2eTmpDir('overlook-e2e-backup-stability-');
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '504',
      OVERLOOK_INSECURE_KEYSTORE: '1',
    },
  });
  try {
    const page = await app.firstWindow({ timeout: 60_000 });
    const grid = page.getByTestId('virtual-grid');
    await grid.waitFor();
    await grid.locator('.ovl-tile__img').first().waitFor({ timeout: 30_000 });
    await expect
      .poll(
        () =>
          grid.evaluate((node) => {
            const element = node as unknown as { readonly scrollHeight: number; readonly clientHeight: number };
            return element.scrollHeight - element.clientHeight;
          }),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
    await grid.evaluate((node) => {
      const element = node as unknown as { readonly scrollHeight: number; scrollTo: (options: { top: number }) => void };
      element.scrollTo({ top: element.scrollHeight });
    });

    const selectedCell = page.locator('.ovl-grid__cell[data-index="501"]');
    // Seed index 502 is offloaded and opening it intentionally emits a
    // structural rehydrate refresh; use a synced neighbor so this test
    // isolates backup-only status traffic.
    const openedCell = page.locator('.ovl-grid__cell[data-index="503"]');
    await selectedCell.locator('.ovl-tile__img').waitFor({ timeout: 30_000 });
    await selectedCell.getByRole('button', { name: 'Select' }).click();
    await openedCell.click();

    const lightbox = page.getByTestId('lightbox');
    const openedName = await lightbox.locator('.ovl-lightbox__img').getAttribute('alt');
    expect(openedName).not.toBeNull();
    await expect(page.getByTestId('selection-pill')).toContainText('1 SELECTED');

    const backup = page.evaluate<{ uploaded: number }>(`window.overlook.backup.run({})`);
    await expect(lightbox).toBeVisible();
    await backup;

    await expect(lightbox).toBeVisible();
    await expect(lightbox.locator('.ovl-lightbox__img')).toHaveAttribute('alt', openedName ?? '');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('selection-pill')).toContainText('1 SELECTED');
  } finally {
    await app.close();
  }
});

// #110 + #306: edits re-dirty (amber returns) and the offloaded → temporary
// view journey — the tile dims, the card split shifts, and verified viewing
// preserves the user's offloaded storage choice.
test('edit re-dirties after a backup; offload → temporary lightbox stream round-trips', async () => {
  const userData = mkE2eTmpDir('overlook-e2e-backup2-');
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
    await page.getByTestId('virtual-grid').waitFor();
    await page.locator('.ovl-tile__img').first().waitFor();

    await page.getByRole('button', { name: 'Back up' }).click();
    await expect(page.getByTestId('sync-state')).toContainText('ALL BACKED UP · JUST NOW', { timeout: 20_000 });

    // Edit → amber returns with the exact count.
    await page.locator('.ovl-grid__cell').nth(1).click();
    await page.getByTestId('lightbox').getByRole('button', { name: 'Favorite' }).click();
    await expect(page.getByTestId('sync-state')).toContainText('ENCRYPTING 1 → LOCAL MOCK');
    await page.keyboard.press('Escape');

    // Offload photo 0 (synced + clean): the card split shifts.
    const offloaded = await page.evaluate<{ offloaded: number }>(`window.overlook.backup.offload({ photoIds: ['01J8SEEDPHOTO0000'] })`);
    expect(offloaded.offloaded).toBe(1);
    await expect(page.getByTestId('backup-card')).not.toContainText('0 B OFFLOAD (LOCAL MOCK)');
    const firstTile = page.locator('.ovl-grid__cell').first();
    await expect(firstTile.getByRole('img', { name: 'Offloaded to cloud' })).toBeVisible();

    // Default-on re-offload policy verifies temporary encrypted custody while
    // the durable row remains offloaded.
    await firstTile.click();
    const lightbox = page.getByTestId('lightbox');
    await expect(lightbox).toBeVisible();
    await expect(lightbox.getByText('STREAMING ORIGINAL · RE-OFFLOADS ON CLOSE')).toBeVisible({ timeout: 15_000 });
    const state = await page.evaluate<string>(
      `window.overlook.library.get({ id: '01J8SEEDPHOTO0000' }).then((r) => r.photo?.syncState ?? '?')`,
    );
    expect(state).toBe('offloaded');
    await lightbox.getByRole('button', { name: 'Close (Esc)' }).click();
  } finally {
    await app.close();
  }
});

// #110 fault injection: a forced upload error surfaces loudly — red retry
// toast and the cloud-alert glyph on the tile.
test('forced upload error: red retry toast + error glyph', async () => {
  // Three retry rounds with real backoffs — 30s flaked on CI under Xvfb.
  test.setTimeout(60_000);
  const userData = mkE2eTmpDir('overlook-e2e-backup3-');
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '4',
      OVERLOOK_INSECURE_KEYSTORE: '1',
      OVERLOOK_BACKUP_FAULT: 'put',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await page.locator('.ovl-tile__img').first().waitFor();

    await page.getByRole('button', { name: 'Back up' }).click();
    await expect(page.getByRole('status')).toContainText('BACKUP: 1 FAILED — WILL RETRY', { timeout: 30_000 });
    // The dirty row went error: its tile carries the cloud-alert glyph.
    await expect(page.locator('.ovl-grid__cell').first().locator('.ovl-tile__status')).toBeVisible();
    const state = await page.evaluate<string>(
      `window.overlook.library.get({ id: '01J8SEEDPHOTO0000' }).then((r) => r.photo?.syncState ?? '?')`,
    );
    expect(state).toBe('error');
  } finally {
    await app.close();
  }
});

test('integrity repair and remote-only loss update in place without clearing selection', async () => {
  const userData = mkE2eTmpDir('overlook-e2e-integrity-');
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '1',
      OVERLOOK_INSECURE_KEYSTORE: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await page.locator('.ovl-tile__img').first().waitFor();
    await page.getByRole('button', { name: 'Back up' }).click();
    await expect(page.getByRole('status')).toContainText('BACKUP COMPLETE', { timeout: 20_000 });

    const [remoteBlob] = remoteBlobFiles(userData);
    if (remoteBlob === undefined) throw new Error('backup did not publish a remote blob');
    const originalCiphertext = readFileSync(remoteBlob);
    writeFileSync(remoteBlob, 'corrupt remote ciphertext');
    await page.evaluate(`window.overlook.backup.run({})`);
    await expect(page.getByRole('status')).toContainText('BACKUP REPAIRED: 1 CLOUD COPIES');
    expect(readFileSync(remoteBlob)).toEqual(originalCiphertext);

    const offloaded = await page.evaluate<{ offloaded: number }>(`window.overlook.backup.offload({ photoIds: ['01J8SEEDPHOTO0000'] })`);
    expect(offloaded.offloaded).toBe(1);
    rmSync(remoteBlob);
    await page.locator('.ovl-grid__cell').first().getByRole('button', { name: 'Select' }).click();
    await page.evaluate(`window.overlook.backup.run({})`);
    await expect(page.getByRole('status')).toContainText('BACKUP DAMAGED: 1 ORIGINALS MISSING');
    await expect(page.getByTestId('selection-pill')).toContainText('1 SELECTED');
    await expect
      .poll(() => page.evaluate(`window.overlook.library.get({ id: '01J8SEEDPHOTO0000' }).then((r) => r.photo?.syncState)`))
      .toBe('error');
  } finally {
    await app.close();
  }
});
