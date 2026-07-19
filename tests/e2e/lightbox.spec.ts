import { test, expect, _electron as electron } from '@playwright/test';

import { mkE2eTmpDir } from './support/tmp-dir.js';

// #93 exit criteria: the mock's keyboard contract in lightbox mode — ←/→
// step the visible sequence with wraparound, Esc closes the lightbox first
// (dual semantics), i toggles the Inspector — all without clicking to focus.
test('lightbox keyboard: arrows with wraparound, i for inspector, Esc precedence', async () => {
  const userData = mkE2eTmpDir('overlook-e2e-lightbox-');
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

    // Open from the grid (photo 0 is the seed's RAW record → PREVIEW badge).
    // Wait for a REAL PhotoTile (placeholder cells render first on a slow
    // first page and have no open handler — PR #188 review).
    await page.locator('.ovl-tile__img').first().waitFor();
    await page.locator('.ovl-grid__cell').first().click();
    const lightbox = page.getByTestId('lightbox');
    await expect(lightbox).toBeVisible();
    await expect(lightbox).toContainText('IMG_4021.RAF');
    await expect(lightbox).toContainText('PREVIEW');

    // → steps forward through the VISIBLE sequence — no click-to-focus.
    await page.keyboard.press('ArrowRight');
    await expect(lightbox).toContainText('IMG_4028.JPG');

    // ← twice from photo 1 wraps past 0 to the LAST photo (index 3).
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(lightbox).toContainText('IMG_4042.JPG');
    // → from the last wraps forward to the first again.
    await page.keyboard.press('ArrowRight');
    await expect(lightbox).toContainText('IMG_4021.RAF');

    // i toggles the Inspector while the lightbox stays up — and the panel
    // shows the REAL record (#94): seeded camera, dimensions, key metadata.
    await page.keyboard.press('i');
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText('RAW');
    await expect(inspector).toContainText('FUJIFILM X-T5');
    await expect(inspector).toContainText('6240×4160 · 26.0 MP');
    await expect(inspector).toContainText('AES-256-GCM · KEY #1');
    await page.keyboard.press('i');
    await expect(inspector).toBeHidden();

    // NOTE on #270: the top row carves itself out of the TitleBar's OS drag
    // region via -webkit-app-region: no-drag (lightbox.css). Drag
    // interception is native and synthetic clicks bypass it, and the
    // computed style string normalizes to 'no-drag' either way — there is
    // no honest automated assertion; the fix is owner-verified in the
    // packaged app. This click DOES prove the button wiring:

    // The explicit ✕ closes back to the gallery (#269)…
    await page.getByRole('button', { name: 'Close (Esc)' }).click();
    await expect(lightbox).toBeHidden();
    await expect(page.getByTestId('virtual-grid')).toBeVisible();

    // …and Esc still closes it too (dual semantics live in the reducer).
    await page.locator('.ovl-grid__cell').first().click();
    await expect(lightbox).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();
    await expect(page.getByTestId('virtual-grid')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('lightbox transform: fill, focal zoom, clamped pan, and lifecycle reset (#307)', async () => {
  const userData = mkE2eTmpDir('overlook-e2e-lightbox-transform-');
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
    await page.locator('.ovl-grid__cell').first().click();

    const viewport = page.getByTestId('lightbox-viewport');
    const image = viewport.getByRole('img');
    const orientationToolbar = page.getByRole('toolbar', { name: 'Image orientation controls' });
    await expect(viewport).toHaveAttribute('data-mode', 'fit');
    await expect(viewport).toHaveAttribute('data-zoom', '1.000');
    await expect(orientationToolbar).toBeVisible();

    await orientationToolbar.getByRole('button', { name: 'Rotate right (])' }).click();
    await expect(viewport).toHaveAttribute('data-orientation-turns', '1');
    await orientationToolbar.getByRole('button', { name: 'Flip horizontal (Backslash)' }).click();
    await expect(viewport).toHaveAttribute('data-orientation-flipped', 'true');
    await page.keyboard.press('r');
    await expect(viewport).toHaveAttribute('data-orientation-turns', '0');
    await expect(viewport).toHaveAttribute('data-orientation-flipped', 'false');

    await page.keyboard.press('+');
    await page.keyboard.press(']');
    await orientationToolbar.getByRole('button', { name: 'Reset orientation (R)' }).click();
    await expect(viewport).toHaveAttribute('data-orientation-turns', '0');
    await expect(viewport).toHaveAttribute('data-zoom', '1.250');
    await page.keyboard.press('0');

    await image.dblclick();
    await expect(viewport).toHaveAttribute('data-mode', 'fill');
    const fillViewportBounds = await viewport.boundingBox();
    const fillImageBounds = await image.boundingBox();
    expect(fillViewportBounds).not.toBeNull();
    expect(fillImageBounds).not.toBeNull();
    expect(fillImageBounds?.width ?? 0).toBeGreaterThanOrEqual((fillViewportBounds?.width ?? 0) - 1);
    expect(fillImageBounds?.height ?? 0).toBeGreaterThanOrEqual((fillViewportBounds?.height ?? 0) - 1);

    const verticalOverflow = ((fillImageBounds?.height ?? 0) - (fillViewportBounds?.height ?? 0)) / 2;
    await page.mouse.wheel(0, 5000);
    await expect.poll(async () => Number(await viewport.getAttribute('data-pan-y'))).toBeCloseTo(-verticalOverflow, 0);
    await page.mouse.wheel(0, -10000);
    await expect.poll(async () => Number(await viewport.getAttribute('data-pan-y'))).toBeCloseTo(verticalOverflow, 0);

    await page.keyboard.press('i');
    await expect(viewport).toHaveAttribute('data-mode', 'fill');
    await expect
      .poll(async () => {
        const viewportBounds = await viewport.boundingBox();
        const imageBounds = await image.boundingBox();
        return Math.min(
          (imageBounds?.width ?? 0) - (viewportBounds?.width ?? 0),
          (imageBounds?.height ?? 0) - (viewportBounds?.height ?? 0),
        );
      })
      .toBeGreaterThanOrEqual(-1);
    await page.keyboard.press('i');
    await expect(viewport).toHaveAttribute('data-mode', 'fill');

    await image.dblclick();
    await expect(viewport).toHaveAttribute('data-mode', 'fit');

    const bounds = await viewport.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move((bounds?.x ?? 0) + (bounds?.width ?? 0) * 0.25, (bounds?.y ?? 0) + (bounds?.height ?? 0) * 0.25);
    await page.keyboard.down('Alt');
    await page.mouse.wheel(0, -600);
    await page.keyboard.up('Alt');
    await expect.poll(async () => Number(await viewport.getAttribute('data-zoom'))).toBeGreaterThan(2);

    await page.mouse.wheel(900, 700);
    await expect.poll(async () => Math.abs(Number(await viewport.getAttribute('data-pan-x')))).toBeGreaterThan(0);
    await expect.poll(async () => Math.abs(Number(await viewport.getAttribute('data-pan-y')))).toBeGreaterThan(0);

    await page.keyboard.press('0');
    await page.keyboard.press('+');
    await expect(viewport).toHaveAttribute('data-zoom', '1.250');
    await page.keyboard.press('0');
    await expect(viewport).toHaveAttribute('data-zoom', '1.000');

    await page.keyboard.press(']');
    await page.keyboard.press('Backslash');
    await page.keyboard.press('+');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('lightbox')).toContainText('IMG_4028.JPG');
    await expect(viewport).toHaveAttribute('data-mode', 'fit');
    await expect(viewport).toHaveAttribute('data-zoom', '1.000');
    await expect(viewport).toHaveAttribute('data-orientation-turns', '0');
    await expect(viewport).toHaveAttribute('data-orientation-flipped', 'false');
  } finally {
    await app.close();
  }
});

// #95 exit criteria: a lightbox favorite behaves like an edit anywhere —
// the ledger dirties (pendingCount), the StatusBar flips amber, and the
// grid tile's star appears, all via targeted pushes with no reload.
test('lightbox favorite: tile star + pendingCount + StatusBar update without reload', async () => {
  const userData = mkE2eTmpDir('overlook-e2e-fav-');
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

    // Seed 4 starts with exactly one dirty row (photo 0 is 'local', and
    // local rows are born dirty) — the favorite must INCREMENT this.
    await expect(page.getByTestId('sync-state')).toContainText('ENCRYPTING 1 → LOCAL MOCK');
    // Photo 1 (IMG_4028.JPG) is not a favorite.
    await expect(page.locator('.ovl-grid__cell').nth(1).locator('.ovl-tile__star')).toHaveCount(0);

    // Favorite it from the lightbox.
    await page.locator('.ovl-grid__cell').nth(1).click();
    const lightbox = page.getByTestId('lightbox');
    await expect(lightbox).toContainText('IMG_4028.JPG');
    await lightbox.getByRole('button', { name: 'Favorite' }).click();

    // Ledger dirties → the StatusBar count increments, exactly…
    await expect(page.getByTestId('sync-state')).toContainText('ENCRYPTING 2 → LOCAL MOCK');
    // …the lightbox star goes active…
    await expect(lightbox.getByRole('button', { name: 'Favorite' })).toHaveClass(/ovl-icon-button--active/);

    // …and back in the grid the tile star appeared — no reload happened.
    await page.keyboard.press('Escape');
    await expect(page.locator('.ovl-grid__cell').nth(1).locator('.ovl-tile__star')).toHaveCount(1);
  } finally {
    await app.close();
  }
});

// #96: the remaining viewing-journey exit criteria — selection intact
// through Esc-from-lightbox (dual semantics at the UI level) and the 2.2s
// chrome autohide observed end-to-end.
test('viewing journey: selection survives Esc-from-lightbox; chrome autohides and wakes', async () => {
  const userData = mkE2eTmpDir('overlook-e2e-journey-');
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

    // Select a photo, then open ANOTHER in the lightbox.
    await page.locator('.ovl-grid__cell').nth(2).getByRole('button', { name: 'Select' }).click();
    await expect(page.getByTestId('selection-pill')).toContainText('1 SELECTED');
    await page.locator('.ovl-grid__cell').first().click();
    const lightbox = page.getByTestId('lightbox');
    const orientationToolbar = page.getByRole('toolbar', { name: 'Image orientation controls' });
    await expect(lightbox).toBeVisible();

    // A click on the photo immediately clears every overlay, and keyboard
    // activity or meaningful pointer movement wakes the chrome again.
    await expect(lightbox).toHaveAttribute('data-chrome', 'on');
    await lightbox.getByRole('img').click();
    await expect(lightbox).toHaveAttribute('data-chrome', 'off');
    await expect(lightbox.locator('.ovl-lightbox__chrome--on')).toHaveCount(0);
    await expect(lightbox.locator('.ovl-lightbox__gesture-hint')).toHaveCount(0);
    await page.keyboard.press('x');
    await expect(lightbox).toHaveAttribute('data-chrome', 'on');

    // The existing idle path remains intact.
    await expect(lightbox).toHaveAttribute('data-chrome', 'off', { timeout: 5000 });
    await expect(orientationToolbar).toHaveCSS('opacity', '0');
    await expect(orientationToolbar).toHaveCSS('pointer-events', 'none');
    await page.mouse.move(300, 300);
    await page.mouse.move(320, 320);
    await expect(lightbox).toHaveAttribute('data-chrome', 'on');
    await expect(orientationToolbar).toHaveCSS('opacity', '1');

    // Esc #1 exits the lightbox ONLY — the selection is intact…
    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();
    await expect(page.getByTestId('selection-pill')).toContainText('1 SELECTED');
    // …Esc #2 clears it (the reducer's dual semantics, at the UI level).
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('selection-pill')).toBeHidden();
  } finally {
    await app.close();
  }
});
