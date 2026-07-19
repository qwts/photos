import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type { OverlookApi } from '../../src/shared/ipc/api.js';

import { mkE2eTmpDir } from './support/tmp-dir.js';

// #483 / ADR-0022: relocation moves a whole library with an atomic registry
// commit. Crash at every §4 boundary and prove exactly one authoritative,
// usable library remains (acceptance 6); refusals leave both sides untouched
// (acceptance 7); the active library reopens from its new home (acceptance 2).

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

async function moveLibrary(
  page: Page,
  id: string,
  destPath: string,
): Promise<Awaited<ReturnType<OverlookApi['libraries']['move']>> | null> {
  return page
    .evaluate(
      async ({ target, dest }) => {
        const overlook = (globalThis as unknown as { overlook: OverlookApi }).overlook;
        return overlook.libraries.move({ id: target, destPath: dest });
      },
      { target: id, dest: destPath },
    )
    .catch((error: unknown) => {
      // Moving the ACTIVE library reloads the window mid-IPC; a fault kills
      // the process outright. Both sever this context — the caller asserts
      // through relaunch/reload instead of a response.
      const message = error instanceof Error ? error.message : String(error);
      if (!/context|destroyed|navigation|Target/iu.test(message)) throw error;
      return null;
    });
}

async function libraryPath(page: Page, id: string): Promise<{ path: string; open: boolean } | null> {
  return page.evaluate(async (target) => {
    const overlook = (globalThis as unknown as { overlook: OverlookApi }).overlook;
    const { libraries } = await overlook.libraries.list();
    const found = libraries.find((lib) => lib.id === target);
    return found === undefined ? null : { path: found.path, open: found.open };
  }, id);
}

test('ACCEPTANCE: an inactive library moves to a new folder and the registry follows (#483 acceptance 1)', async () => {
  test.setTimeout(60_000);
  const userData = mkE2eTmpDir('overlook-e2e-reloc-');
  const app = await launch(userData, { OVERLOOK_SEED: '1' });
  try {
    const page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    const secondId = await createSecondLibrary(page);
    const dest = join(userData, 'moved', 'Second');
    mkdirSync(join(userData, 'moved'), { recursive: true });

    const outcome = await moveLibrary(page, secondId, dest);
    expect(outcome).toMatchObject({ ok: true, outcome: 'moved' });
    expect(await libraryPath(page, secondId)).toMatchObject({ path: dest });
    expect(existsSync(join(dest, 'library-id'))).toBe(true);
  } finally {
    await app.close();
  }
});

test('ACCEPTANCE: the ACTIVE library moves (copy mode), reopens from the destination, and keeps its photos (#483 acceptance 2/5)', async () => {
  test.setTimeout(90_000);
  const userData = mkE2eTmpDir('overlook-e2e-reloc-active-');
  const app = await launch(userData, { OVERLOOK_SEED: '3', OVERLOOK_RELOCATION_FORCE_COPY: '1' });
  try {
    let page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(3);
    const activeId = await page.evaluate(async () => {
      const overlook = (globalThis as unknown as { overlook: OverlookApi }).overlook;
      return (await overlook.libraries.current()).library.id;
    });
    const dest = join(userData, 'moved', 'Active');
    mkdirSync(join(userData, 'moved'), { recursive: true });

    await moveLibrary(page, activeId, dest);

    // The move reactivates + reloads the window from the destination.
    page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await expect(page.getByTestId('virtual-grid').locator('.ovl-grid__cell')).toHaveCount(3);
    expect(await libraryPath(page, activeId)).toMatchObject({ path: dest, open: true });
  } finally {
    await app.close();
  }
});

test('ACCEPTANCE: a crash at every §4 boundary leaves exactly one authoritative, usable library (#483 acceptance 6)', async () => {
  test.setTimeout(300_000);
  for (const point of ['after-copy', 'after-verify', 'after-activate', 'after-commit'] as const) {
    const userData = mkE2eTmpDir(`overlook-e2e-reloc-crash-${point}-`);
    const crashed = await launch(userData, { OVERLOOK_SEED: '1', OVERLOOK_RELOCATION_FORCE_COPY: '1', OVERLOOK_RELOCATION_FAULT: point });
    const page = await crashed.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    const secondId = await createSecondLibrary(page);
    const sourcePath = (await libraryPath(page, secondId))?.path ?? '';
    const dest = join(userData, 'moved', 'Second');
    mkdirSync(join(userData, 'moved'), { recursive: true });

    const exited = new Promise<void>((resolve) => crashed.process().once('exit', () => resolve()));
    await moveLibrary(page, secondId, dest);
    await exited;

    // Relaunch clean: startup recovery settles the journal before anything
    // opens (ADR-0022 §2). Pre-commit faults leave the SOURCE authoritative
    // with destination-side staging discarded; the post-commit fault leaves
    // the DESTINATION authoritative with the source cleaned up.
    const app = await launch(userData);
    try {
      const relaunched = await app.firstWindow();
      await relaunched.getByTestId('virtual-grid').waitFor();
      const after = await libraryPath(relaunched, secondId);
      const preCommit = point !== 'after-commit';
      expect(after?.path).toBe(preCommit ? sourcePath : dest);
      expect(existsSync(preCommit ? sourcePath : dest)).toBe(true);
      expect(existsSync(preCommit ? dest : sourcePath)).toBe(false);
      expect(existsSync(`${dest}.relocate-staging`)).toBe(false);
    } finally {
      await app.close();
    }
  }
});

test('ACCEPTANCE: a non-empty destination refuses — never overwrites, never merges (#483 acceptance 7)', async () => {
  test.setTimeout(60_000);
  const userData = mkE2eTmpDir('overlook-e2e-reloc-refuse-');
  const app = await launch(userData, { OVERLOOK_SEED: '1' });
  try {
    const page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    const secondId = await createSecondLibrary(page);
    const before = (await libraryPath(page, secondId))?.path ?? '';

    // The profile directory itself is occupied — a guaranteed-non-empty target.
    const outcome = await moveLibrary(page, secondId, userData);
    expect(outcome).toMatchObject({ ok: false });
    expect(await libraryPath(page, secondId)).toMatchObject({ path: before });
    expect(existsSync(join(before, 'library-id'))).toBe(true);
  } finally {
    await app.close();
  }
});

// The wizard-driven flow (Review → Progress → Results through the real UI,
// multi-select batch) lands with the follow-up slice once the wizard (#557)
// and this engine hardening are both on main.
