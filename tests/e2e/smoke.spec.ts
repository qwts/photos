import { test, expect } from '@playwright/test';

test('serves the fixture page', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.getByRole('heading', { name: 'photos' })).toBeVisible();
});
