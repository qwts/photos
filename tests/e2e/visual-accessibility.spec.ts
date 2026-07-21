import type { Locator, Page } from '@playwright/test';

import { expect, test } from './support/app.js';

async function expectInsideViewport(locator: Locator, page: Page): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const viewport = await page.evaluate<{ width: number; height: number }>('({ width: window.innerWidth, height: window.innerHeight })');
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? viewport.width) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
  expect((box?.y ?? viewport.height) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
}

test('reduced motion collapses shared transitions and repeating status animation', async ({ launchOverlook }) => {
  const { page } = await launchOverlook({ prefix: 'overlook-e2e-visual-motion-', env: { OVERLOOK_SEED: '4' } });
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCSS('animation-duration', '0.001s');
  await page.keyboard.press('Escape');

  await page.locator('.ovl-grid__cell').first().click();
  const chromeDuration = await page.evaluate<string>(
    "getComputedStyle(document.querySelector('.ovl-lightbox__chrome')).transitionDuration",
  );
  expect(chromeDuration).toBe('0.001s');

  const repeatingMotion = await page.evaluate<{ duration: string; iterations: string }>(`(() => {
    const probe = document.createElement('span');
    probe.className = 'ovl-statusbar__spin';
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const result = { duration: style.animationDuration, iterations: style.animationIterationCount };
    probe.remove();
    return result;
  })()`);
  expect(repeatingMotion).toEqual({ duration: '0.001s', iterations: '1' });
});

test('shell, Settings, grid, and Lightbox controls remain reachable at 200% Electron zoom', async ({ launchOverlook }) => {
  const { app, page } = await launchOverlook({ prefix: 'overlook-e2e-visual-zoom-', env: { OVERLOOK_SEED: '12' } });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(2));
  await expect.poll(() => page.evaluate<number>('window.devicePixelRatio')).toBe(2);

  const settings = page.getByRole('button', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await expectInsideViewport(settings, page);
  await settings.click();

  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expectInsideViewport(dialog, page);
  await expectInsideViewport(page.getByRole('tab', { name: 'General' }), page);
  await expectInsideViewport(dialog.getByRole('button', { name: 'Close' }), page);
  await dialog.getByRole('button', { name: 'Close' }).click();

  const firstPhoto = page.locator('.ovl-grid__cell').first();
  await expect(firstPhoto).toBeVisible();
  await firstPhoto.click();
  const lightbox = page.getByTestId('lightbox');
  await expect(lightbox).toBeVisible();
  await expectInsideViewport(lightbox.getByRole('button', { name: 'Close lightbox' }), page);
  await expectInsideViewport(lightbox.getByLabel('Image zoom controls'), page);
});
