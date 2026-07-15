import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';

// #108 exit criteria (amended by #266): the full visual choreography of a
// mock-provider backup run — amber → green flip, live counts, "JUST NOW"
// reset, and the button LEAVING at pendingCount 0 (an idle affordance
// misstates that there is work; it returns when a change dirties a row).
test('backup choreography: amber → green, JUST NOW reset, button hides at 0', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-backup-'));
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
    await expect(page.getByTestId('sync-state')).toContainText('ENCRYPTING 1 → PCLOUD');
    const backupButton = page.getByRole('button', { name: 'Back up' });
    await expect(backupButton).toBeEnabled();
    await expect(page.getByTestId('backup-card')).toContainText('LOCAL · 0 B PCLOUD');

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
    // "ENCRYPTING 1 → PCLOUD" forever.
    await expect(page.getByTestId('sync-state')).toContainText('ALL BACKED UP', { timeout: 20_000 });
    await expect(backupButton).toBeHidden();
  } finally {
    await app.close();
  }
});

// #295 regression: backup status changes are not structural invalidations.
// Keep two deep-page UI anchors alive while hundreds of dirty rows settle.
test('large backup preserves deep selection and an open lightbox', async () => {
  test.setTimeout(90_000);
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-backup-stability-'));
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
    const page = await app.firstWindow();
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

// #110: edits re-dirty (amber returns) and the offloaded → rehydrate
// journey — the tile dims, the card split shifts, and the lightbox brings
// the original back.
test('edit re-dirties after a backup; offload → lightbox rehydrate round-trips', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-backup2-'));
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
    await expect(page.getByTestId('sync-state')).toContainText('ENCRYPTING 1 → PCLOUD');
    await page.keyboard.press('Escape');

    // Offload photo 0 (synced + clean): the card split shifts.
    const offloaded = await page.evaluate<{ offloaded: number }>(`window.overlook.backup.offload({ photoIds: ['01J8SEEDPHOTO0000'] })`);
    expect(offloaded.offloaded).toBe(1);
    await expect(page.getByTestId('backup-card')).not.toContainText('· 0 B PCLOUD');

    // Open it in the lightbox: rehydrate fires and the row returns synced.
    await page.locator('.ovl-grid__cell').first().click();
    await expect(page.getByTestId('lightbox')).toBeVisible();
    await expect
      .poll(
        async () =>
          page.evaluate<string>(`window.overlook.library.get({ id: '01J8SEEDPHOTO0000' }).then((r) => r.photo?.syncState ?? '?')`),
        { timeout: 15_000 },
      )
      .toBe('synced');
  } finally {
    await app.close();
  }
});

// #110 fault injection: a forced upload error surfaces loudly — red retry
// toast and the cloud-alert glyph on the tile.
test('forced upload error: red retry toast + error glyph', async () => {
  // Three retry rounds with real backoffs — 30s flaked on CI under Xvfb.
  test.setTimeout(60_000);
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-backup3-'));
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
