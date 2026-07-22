import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

import { mkE2eTmpDir } from './support/tmp-dir.js';

// End-to-end verification of the Moodboard view (#515 / #697): the view renders
// in the real app, and a board's layout persists byte-stably across an app
// restart against the encrypted library store (invariant I2). Layout metadata
// only — no original pixels are touched.

interface BoardResult {
  readonly board: {
    readonly background: string;
    readonly title: string;
    readonly placements: readonly { readonly x: number; readonly y: number; readonly rotation: number }[];
  } | null;
}

const SAVED_BOARD = {
  id: 'board-local',
  title: 'Restart proof',
  notes: 'kept across restart',
  size: { width: 1920, height: 1080 },
  background: 'navy',
  placements: [
    {
      id: 'a',
      photoId: 'photo-a',
      x: 12,
      y: 34,
      w: 260,
      h: 190,
      rotation: 30,
      crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      z: 1,
      groupId: null,
    },
    { id: 'b', photoId: 'photo-b', x: 400, y: 220, w: 200, h: 150, rotation: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, z: 2, groupId: null },
  ],
} as const;

test('Moodboard view renders and its layout survives an app restart (I2)', async () => {
  const userData = mkE2eTmpDir('overlook-e2e-moodboard-');
  const launch = (): Promise<ElectronApplication> =>
    electron.launch({
      args: ['.'],
      env: { ...process.env, OVERLOOK_USER_DATA: userData, OVERLOOK_SEED: '3', OVERLOOK_INSECURE_KEYSTORE: '1' },
    });

  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();

    // Switch to the Moodboard view; the role=application canvas renders and the
    // parallel reading-order list is present for assistive tech.
    await page.getByRole('radio', { name: 'Moodboard' }).click();
    await expect(page.getByRole('application', { name: /Moodboard canvas/ })).toBeVisible();
    await expect(page.getByLabel('Placements in reading order')).toBeAttached();

    // Persist a known board through the validated IPC, then read it back.
    // String-form evaluate: window.overlook is not typed in the e2e project.
    await page.evaluate(`window.overlook.boards.save({ board: ${JSON.stringify(SAVED_BOARD)} })`);
    const saved = await page.evaluate<BoardResult>(`window.overlook.boards.get({ boardId: 'board-local' })`);
    expect(saved.board?.background).toBe('navy');

    await app.close();

    // Relaunch against the same encrypted library — the exact layout returns.
    app = await launch();
    page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    const restored = await page.evaluate<BoardResult>(`window.overlook.boards.get({ boardId: 'board-local' })`);
    expect(restored.board?.title).toBe('Restart proof');
    expect(restored.board?.background).toBe('navy');
    expect(restored.board?.placements[0]).toMatchObject({ x: 12, y: 34, rotation: 30 });
    expect(restored.board?.placements).toHaveLength(2);
  } finally {
    await app.close();
  }
});
