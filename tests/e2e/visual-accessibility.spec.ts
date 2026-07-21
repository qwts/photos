import type { Page } from '@playwright/test';

import { expect, test } from './support/app.js';

async function expectInsideViewport(selector: string, page: Page): Promise<void> {
  const layout = await page.evaluate<{ left: number; top: number; right: number; bottom: number; width: number; height: number }>(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing visual-accessibility target: ${selector}');
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: window.innerWidth, height: window.innerHeight };
  })()`);
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.width);
  expect(layout.bottom).toBeLessThanOrEqual(layout.height);
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
  const zoomFactor = await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents;
    contents?.setZoomFactor(2);
    return contents?.getZoomFactor();
  });
  expect(zoomFactor).toBe(2);
  await expect.poll(() => page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);

  const settings = page.getByRole('button', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await settings.scrollIntoViewIfNeeded();
  await expectInsideViewport('.ovl-sidebar__gear', page);
  await settings.click();

  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expectInsideViewport('[data-testid="settings-dialog"]', page);
  await expectInsideViewport('.ovl-settings__navrow', page);
  await expectInsideViewport('.ovl-dialog__header button', page);
  await dialog.getByRole('button', { name: 'Close' }).click();

  const firstPhoto = page.locator('.ovl-grid__cell').first();
  await expect(firstPhoto).toBeVisible();
  await firstPhoto.click();
  const lightbox = page.getByTestId('lightbox');
  await expect(lightbox).toBeVisible();
  await expect(lightbox.getByRole('button', { name: 'Close (Esc)' })).toBeVisible();
  await expect(lightbox.getByLabel('Image zoom controls')).toBeVisible();
  await expectInsideViewport('.ovl-lightbox__top button:last-of-type', page);
  await expectInsideViewport('.ovl-lightbox__zoom', page);
});
