import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type { OverlookApi } from '../../src/shared/ipc/api.js';

// #385 / ADR-0017 §4: live switch tears down and rebuilds with no cross-
// library bleed; a crash mid-switch relaunches into the registry-selected
// library with both libraries consistent.

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

async function createSecondLibrary(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const overlook = (globalThis as unknown as { overlook: OverlookApi }).overlook;
    const { library } = await overlook.libraries.create({ name: 'Second', path: null });
    return library.id;
  });
}

async function switchTo(page: Page, id: string): Promise<void> {
  // The switch reloads the window mid-IPC; the severed execution context is
  // the expected shape of success from the renderer's point of view.
  await page
    .evaluate(async (target) => {
      const overlook = (globalThis as unknown as { overlook: OverlookApi }).overlook;
      await overlook.libraries.open({ id: target });
    }, id)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!/context|destroyed|navigation|Target/iu.test(message)) throw error;
    });
}

async function currentLibrary(page: Page): Promise<{ id: string; open: boolean; photos: number }> {
  return page.evaluate(async () => {
    const overlook = (globalThis as unknown as { overlook: OverlookApi }).overlook;
    const [{ library }, stats] = await Promise.all([overlook.libraries.current(), overlook.library.stats()]);
    return { id: library.id, open: library.open, photos: stats.photos };
  });
}

test('ACCEPTANCE: switch shows no stale content, and the selection survives a relaunch (#385)', async () => {
  test.setTimeout(60_000);
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-switch-'));

  let app = await launch(userData, { OVERLOOK_SEED: '3' });
  try {
    let page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(3);

    const first = await currentLibrary(page);
    const firstThumb = await page.locator('.ovl-tile__img').first().getAttribute('src');
    expect(firstThumb).not.toBeNull();
    await page.evaluate(async () => {
      const overlook = (globalThis as unknown as { overlook: OverlookApi }).overlook;
      await overlook.settings.set({ patch: { providerId: 'mock', sortOrder: 'name' } });
    });

    const secondId = await createSecondLibrary(page);
    await switchTo(page, secondId);

    // The renderer reloaded into the new library: empty, no stale grid rows,
    // no stale counts (acceptance 4).
    page = await app.firstWindow();
    await page.getByTestId('empty-state').waitFor();
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(0);
    const after = await currentLibrary(page);
    expect(after).toMatchObject({ id: secondId, open: true, photos: 0 });

    const staleThumb = await page.evaluate(
      async (url) =>
        fetch(url)
          .then((response) => ({ loaded: response.ok, status: response.status }))
          .catch(() => ({ loaded: false, status: 0 })),
      firstThumb as string,
    );
    expect(staleThumb.loaded).toBe(false);

    // Provider selection and every backup/offload policy are library-local.
    // Make B explicitly disconnected, then prove A remains connected after
    // both provider-instance and renderer teardown/rebuild.
    const disconnected = await page.evaluate(async () => {
      const overlook = (globalThis as unknown as { overlook: OverlookApi }).overlook;
      await overlook.settings.set({ patch: { providerId: null, sortOrder: 'size' } });
      const run = await overlook.backup.run({});
      return { settings: (await overlook.settings.get()).settings, skipped: run.skipped };
    });
    expect(disconnected).toMatchObject({ settings: { providerId: null, sortOrder: 'size' }, skipped: 'disconnected' });
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByTestId('provider-card')).toContainText('Not connected');
    await page.keyboard.press('Escape');

    await switchTo(page, first.id);
    page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    const reactivated = await page.evaluate(async () => {
      const overlook = (globalThis as unknown as { overlook: OverlookApi }).overlook;
      return {
        settings: (await overlook.settings.get()).settings,
        status: await overlook.backup.providerStatus({ providerId: 'mock' }),
      };
    });
    expect(reactivated).toMatchObject({ settings: { providerId: 'mock', sortOrder: 'name' }, status: { connected: true } });
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByTestId('provider-card')).toContainText('Connected');
    await page.keyboard.press('Escape');

    await switchTo(page, secondId);
    page = await app.firstWindow();
    await page.getByTestId('empty-state').waitFor();
    const secondSettings = await page.evaluate(async () => {
      const overlook = (globalThis as unknown as { overlook: OverlookApi }).overlook;
      return (await overlook.settings.get()).settings;
    });
    expect(secondSettings).toMatchObject({ providerId: null, sortOrder: 'size' });

    await app.close();

    // Relaunch: startup selection opens the switched-to library.
    app = await launch(userData);
    page = await app.firstWindow();
    await page.getByTestId('empty-state').waitFor();
    expect((await currentLibrary(page)).id).toBe(secondId);
  } finally {
    await app.close();
  }
});

test('ACCEPTANCE: a crash mid-switch relaunches into the registry-selected library; both libraries stay consistent (#385)', async () => {
  test.setTimeout(60_000);
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-switch-crash-'));

  const crashed = await launch(userData, { OVERLOOK_SEED: '3', OVERLOOK_SWITCH_FAULT: 'after-close' });
  const crashedPage = await crashed.firstWindow();
  await crashedPage.getByTestId('virtual-grid').waitFor();
  const firstId = (await currentLibrary(crashedPage)).id;
  const secondId = await createSecondLibrary(crashedPage);

  const exited = new Promise<void>((resolve) => crashed.process().once('exit', () => resolve()));
  await switchTo(crashedPage, secondId);
  await exited; // the fault kills the process between teardown and reopen

  // Relaunch without the fault: the stamped selection wins (acceptance 3)...
  const app = await launch(userData);
  try {
    let page = await app.firstWindow();
    await page.getByTestId('empty-state').waitFor();
    expect((await currentLibrary(page)).id).toBe(secondId);

    // ...and the interrupted library recovered cleanly: switching back shows
    // its full content (maintenance green, WAL replayed, lock reclaimed).
    await switchTo(page, firstId);
    page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(3);
    expect((await currentLibrary(page)).id).toBe(firstId);
  } finally {
    await app.close();
  }
});
