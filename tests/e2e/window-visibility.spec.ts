import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, _electron as electron } from '@playwright/test';

test('Electron window follows the centrally configured hidden or visible E2E mode', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-window-'));
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, OVERLOOK_USER_DATA: userData, OVERLOOK_INSECURE_KEYSTORE: '1' },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId('restore-onboarding')).toBeVisible();
    const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false);
    expect(visible).toBe(process.env['OVERLOOK_E2E_WINDOW'] === 'visible');
  } finally {
    await app.close();
  }
});
