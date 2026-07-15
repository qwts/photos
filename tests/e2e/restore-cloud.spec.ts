import { cpSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import type { OverlookApi } from '../../src/shared/ipc/api.js';
import type { PhotoRecord } from '../../src/shared/library/types.js';

const PASSWORD = 'correct horse battery staple';
const PHOTO_COUNT = 4;

type RecoverablePhoto = Pick<
  PhotoRecord,
  | 'id'
  | 'fileName'
  | 'fileKind'
  | 'width'
  | 'height'
  | 'bytes'
  | 'contentHash'
  | 'camera'
  | 'lens'
  | 'iso'
  | 'aperture'
  | 'shutter'
  | 'focalLength'
  | 'takenAt'
  | 'gpsLat'
  | 'gpsLon'
  | 'place'
  | 'importedAt'
  | 'importSource'
  | 'favorite'
  | 'keyId'
  | 'deletedAt'
>;

interface RecoverableSnapshot {
  readonly photos: readonly RecoverablePhoto[];
  readonly albumId: string;
  readonly albumPhotoIds: readonly string[];
}

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

test('fresh profile restores complete state; wrong password is isolated and cancellation resumes (#291)', async () => {
  const source = mkdtempSync(join(tmpdir(), 'overlook-e2e-restore-source-'));
  const target = mkdtempSync(join(tmpdir(), 'overlook-e2e-restore-target-'));
  const keyPath = join(mkdtempSync(join(tmpdir(), 'overlook-e2e-restore-key-')), 'overlook-recovery.key');
  const expected = await (async (): Promise<RecoverableSnapshot> => {
    const sourceApp = await launch(source, { OVERLOOK_SEED: String(PHOTO_COUNT), OVERLOOK_KEY_EXPORT_DESTINATION: keyPath });
    try {
      const page = await sourceApp.firstWindow();
      await page.getByTestId('virtual-grid').waitFor();
      const snapshot = await page.evaluate<RecoverableSnapshot>(async () => {
        const api = (globalThis as unknown as { overlook: OverlookApi }).overlook;
        const { photos } = await api.library.page({ source: 'all', limit: 100 });
        const { album } = await api.albums.create({ name: 'Recovery proof' });
        const albumPhotoIds = photos.slice(0, 3).map((photo) => photo.id);
        await api.albums.addPhotos({ albumId: album.id, photoIds: albumPhotoIds });
        for (const photo of photos) await api.library.toggleFavorite({ id: photo.id });
        const updated = await api.library.page({ source: 'all', limit: 100 });
        return {
          photos: updated.photos.map(({ syncState: _syncState, ...recoverable }) => recoverable),
          albumId: album.id,
          albumPhotoIds,
        };
      });
      const exported = await page.evaluate(
        (password) => (globalThis as unknown as { overlook: OverlookApi }).overlook.keys.export({ password }),
        PASSWORD,
      );
      expect(exported.path).toBe(keyPath);
      const backup = await page.evaluate(() => (globalThis as unknown as { overlook: OverlookApi }).overlook.backup.run({}));
      expect(backup).toMatchObject({ failed: 0, skipped: null });
      await expect
        .poll(() =>
          page.evaluate(() => (globalThis as unknown as { overlook: OverlookApi }).overlook.library.stats()).then((s) => s.pending),
        )
        .toBe(0);
      return snapshot;
    } finally {
      await sourceApp.close();
    }
  })();

  cpSync(join(source, 'mock-remote'), join(target, 'mock-remote'), { recursive: true });
  const targetApp = await launch(target, {
    OVERLOOK_KEY_IMPORT_SOURCE: keyPath,
    OVERLOOK_RESTORE_NO_RELAUNCH: '1',
  });
  try {
    const page = await targetApp.firstWindow();
    await expect(page.getByTestId('restore-onboarding')).toBeVisible();
    await page.getByRole('button', { name: 'Choose recovery key' }).click();
    await page.getByLabel('Recovery-key password').fill('wrong password');
    await page.getByRole('button', { name: 'Discover backups' }).click();
    await expect(page.getByRole('alert')).toContainText('password is incorrect');
    expect(existsSync(join(target, 'library', 'library.db'))).toBe(false);

    await page.getByLabel('Recovery-key password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Discover backups' }).click();
    await expect(page.getByTestId('restore-library-card')).toContainText(`${String(PHOTO_COUNT)} PHOTOS`);
    await page.getByRole('button', { name: 'Review restore' }).click();
    await page.getByRole('button', { name: `Restore ${String(PHOTO_COUNT)} photos` }).click();
    await expect(page.getByRole('button', { name: 'Cancel and keep staged progress' })).toBeVisible();
    await page.evaluate(() => (globalThis as unknown as { overlook: OverlookApi }).overlook.restore.cancel({}));
    await expect(page.getByRole('alert')).toContainText('Restore paused');
    expect(existsSync(join(target, 'library', 'library.db'))).toBe(false);

    await page.getByRole('button', { name: `Restore ${String(PHOTO_COUNT)} photos` }).click();
    await expect(page.getByText('Restore complete')).toBeVisible({ timeout: 30_000 });
    expect(existsSync(join(target, 'library', 'library.db'))).toBe(true);
  } finally {
    await targetApp.close();
  }

  const relaunched = await launch(target);
  try {
    const page = await relaunched.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();
    await expect(page.getByTestId('statusbar-left')).toContainText(`${String(PHOTO_COUNT)} PHOTOS`);
    await expect(page.getByTestId('restore-onboarding')).not.toBeVisible();
    const restored = await page.evaluate<RecoverableSnapshot>(async () => {
      const api = (globalThis as unknown as { overlook: OverlookApi }).overlook;
      const { photos } = await api.library.page({ source: 'all', limit: 100 });
      const { albums } = await api.library.albums();
      const album = albums.find((candidate) => candidate.name === 'Recovery proof');
      if (album === undefined) throw new Error('restored album is missing');
      const members = await api.library.page({ source: 'all', albumId: album.id, limit: 100 });
      return {
        photos: photos.map(({ syncState: _syncState, ...recoverable }) => recoverable),
        albumId: album.id,
        albumPhotoIds: members.photos.map((photo) => photo.id),
      };
    });
    expect(restored).toEqual(expected);
    const first = restored.photos[0];
    expect(first).toBeDefined();
    const viewable = await page.evaluate<{ status: number; jpeg: boolean }>(`fetch('overlook-full://library/${first?.id ?? ''}').then(
      async (response) => {
        const bytes = new Uint8Array(await response.arrayBuffer());
        return { status: response.status, jpeg: bytes[0] === 0xff && bytes[1] === 0xd8 };
      },
    )`);
    expect(viewable).toEqual({ status: 200, jpeg: true });
  } finally {
    await relaunched.close();
  }
});
