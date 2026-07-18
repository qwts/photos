# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: restore-cloud.spec.ts >> corrupt newest manifest falls back and reports the rejected generation (#291)
- Location: tests/e2e/restore-cloud.spec.ts:186:1

# Error details

```
Error: ENOENT: no such file or directory, scandir '/tmp/overlook-e2e-fallback-target-hv7mn7/mock-remote/manifest'
```

# Test source

```ts
  1   | import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
  2   | import { tmpdir } from 'node:os';
  3   | import { join } from 'node:path';
  4   | 
  5   | import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
  6   | import type { OverlookApi } from '../../src/shared/ipc/api.js';
  7   | import type { PhotoRecord } from '../../src/shared/library/types.js';
  8   | 
  9   | const PASSWORD = 'correct horse battery staple';
  10  | const PHOTO_COUNT = 4;
  11  | 
  12  | type RecoverablePhoto = Pick<
  13  |   PhotoRecord,
  14  |   | 'id'
  15  |   | 'fileName'
  16  |   | 'fileKind'
  17  |   | 'width'
  18  |   | 'height'
  19  |   | 'bytes'
  20  |   | 'contentHash'
  21  |   | 'camera'
  22  |   | 'lens'
  23  |   | 'iso'
  24  |   | 'aperture'
  25  |   | 'shutter'
  26  |   | 'focalLength'
  27  |   | 'takenAt'
  28  |   | 'gpsLat'
  29  |   | 'gpsLon'
  30  |   | 'place'
  31  |   | 'importedAt'
  32  |   | 'importSource'
  33  |   | 'favorite'
  34  |   | 'keyId'
  35  |   | 'deletedAt'
  36  | >;
  37  | 
  38  | interface RecoverableSnapshot {
  39  |   readonly photos: readonly RecoverablePhoto[];
  40  |   readonly albumId: string;
  41  |   readonly albumPhotoIds: readonly string[];
  42  | }
  43  | 
  44  | function launch(userData: string, extra: Record<string, string> = {}): Promise<ElectronApplication> {
  45  |   return electron.launch({
  46  |     args: ['.'],
  47  |     env: {
  48  |       ...process.env,
  49  |       OVERLOOK_USER_DATA: userData,
  50  |       OVERLOOK_INSECURE_KEYSTORE: '1',
  51  |       ...extra,
  52  |     },
  53  |   });
  54  | }
  55  | 
  56  | async function backupSimpleSource(source: string, keyPath: string): Promise<readonly string[]> {
  57  |   const app = await launch(source, { OVERLOOK_SEED: '2', OVERLOOK_KEY_EXPORT_DESTINATION: keyPath });
  58  |   try {
  59  |     const page = await app.firstWindow();
  60  |     await page.getByTestId('virtual-grid').waitFor();
  61  |     const hashes = await page.evaluate<readonly string[]>(async () => {
  62  |       const api = (globalThis as unknown as { overlook: OverlookApi }).overlook;
  63  |       const { photos } = await api.library.page({ source: 'all', limit: 100 });
  64  |       for (const photo of photos) await api.library.toggleFavorite({ id: photo.id });
  65  |       return photos.map((photo) => photo.contentHash);
  66  |     });
  67  |     await page.evaluate((password) => (globalThis as unknown as { overlook: OverlookApi }).overlook.keys.export({ password }), PASSWORD);
  68  |     const backup = await page.evaluate(() => (globalThis as unknown as { overlook: OverlookApi }).overlook.backup.run({}));
  69  |     expect(backup).toMatchObject({ failed: 0, skipped: null });
  70  |     return hashes;
  71  |   } finally {
  72  |     await app.close();
  73  |   }
  74  | }
  75  | 
  76  | function highestManifestGeneration(remoteDir: string): number {
> 77  |   return Math.max(...readdirSync(join(remoteDir, 'manifest')).map((name) => Number(/^gen-(\d+)\.ovlk$/u.exec(name)?.[1] ?? Number.NaN)));
      |                      ^ Error: ENOENT: no such file or directory, scandir '/tmp/overlook-e2e-fallback-target-hv7mn7/mock-remote/manifest'
  78  | }
  79  | 
  80  | test('fresh profile restores complete state; wrong password is isolated and cancellation resumes (#291)', async () => {
  81  |   test.setTimeout(60_000);
  82  |   const source = mkdtempSync(join(tmpdir(), 'overlook-e2e-restore-source-'));
  83  |   const target = mkdtempSync(join(tmpdir(), 'overlook-e2e-restore-target-'));
  84  |   const keyPath = join(mkdtempSync(join(tmpdir(), 'overlook-e2e-restore-key-')), 'overlook-recovery.key');
  85  |   const expected = await (async (): Promise<RecoverableSnapshot> => {
  86  |     const sourceApp = await launch(source, { OVERLOOK_SEED: String(PHOTO_COUNT), OVERLOOK_KEY_EXPORT_DESTINATION: keyPath });
  87  |     try {
  88  |       const page = await sourceApp.firstWindow();
  89  |       await page.getByTestId('virtual-grid').waitFor();
  90  |       const snapshot = await page.evaluate<RecoverableSnapshot>(async () => {
  91  |         const api = (globalThis as unknown as { overlook: OverlookApi }).overlook;
  92  |         const { photos } = await api.library.page({ source: 'all', limit: 100 });
  93  |         const { album } = await api.albums.create({ name: 'Recovery proof' });
  94  |         const albumPhotoIds = photos.slice(0, 3).map((photo) => photo.id);
  95  |         await api.albums.addPhotos({ albumId: album.id, photoIds: albumPhotoIds });
  96  |         for (const photo of photos) await api.library.toggleFavorite({ id: photo.id });
  97  |         const updated = await api.library.page({ source: 'all', limit: 100 });
  98  |         return {
  99  |           photos: updated.photos.map(({ syncState: _syncState, ...recoverable }) => recoverable),
  100 |           albumId: album.id,
  101 |           albumPhotoIds,
  102 |         };
  103 |       });
  104 |       const exported = await page.evaluate(
  105 |         (password) => (globalThis as unknown as { overlook: OverlookApi }).overlook.keys.export({ password }),
  106 |         PASSWORD,
  107 |       );
  108 |       expect(exported.path).toBe(keyPath);
  109 |       const backup = await page.evaluate(() => (globalThis as unknown as { overlook: OverlookApi }).overlook.backup.run({}));
  110 |       expect(backup).toMatchObject({ failed: 0, skipped: null });
  111 |       await expect
  112 |         .poll(() =>
  113 |           page.evaluate(() => (globalThis as unknown as { overlook: OverlookApi }).overlook.library.stats()).then((s) => s.pending),
  114 |         )
  115 |         .toBe(0);
  116 |       return snapshot;
  117 |     } finally {
  118 |       await sourceApp.close();
  119 |     }
  120 |   })();
  121 | 
  122 |   cpSync(join(source, 'mock-remote'), join(target, 'mock-remote'), { recursive: true });
  123 |   const targetApp = await launch(target, {
  124 |     OVERLOOK_KEY_IMPORT_SOURCE: keyPath,
  125 |     OVERLOOK_RESTORE_NO_RELAUNCH: '1',
  126 |   });
  127 |   try {
  128 |     const page = await targetApp.firstWindow();
  129 |     await expect(page.getByTestId('restore-onboarding')).toBeVisible();
  130 |     await page.getByRole('button', { name: 'Choose recovery key' }).click();
  131 |     await page.getByLabel('Recovery-key password').fill('wrong password');
  132 |     await page.getByRole('button', { name: 'Discover backups' }).click();
  133 |     await expect(page.getByRole('alert')).toContainText('password is incorrect');
  134 |     expect(existsSync(join(target, 'library', 'library.db'))).toBe(false);
  135 | 
  136 |     await page.getByLabel('Recovery-key password').fill(PASSWORD);
  137 |     await page.getByRole('button', { name: 'Discover backups' }).click();
  138 |     await expect(page.getByTestId('restore-library-card')).toContainText(`${String(PHOTO_COUNT)} PHOTOS`);
  139 |     await page.getByRole('button', { name: 'Review restore' }).click();
  140 |     await page.getByRole('button', { name: `Restore ${String(PHOTO_COUNT)} photos` }).click();
  141 |     await expect(page.getByRole('button', { name: 'Cancel and keep staged progress' })).toBeVisible();
  142 |     await page.evaluate(() => (globalThis as unknown as { overlook: OverlookApi }).overlook.restore.cancel({}));
  143 |     await expect(page.getByRole('alert')).toContainText('Restore paused');
  144 |     expect(existsSync(join(target, 'library', 'library.db'))).toBe(false);
  145 | 
  146 |     await page.getByRole('button', { name: `Restore ${String(PHOTO_COUNT)} photos` }).click();
  147 |     await expect.poll(() => existsSync(join(target, 'library', 'library.db')), { timeout: 30_000 }).toBe(true);
  148 |   } finally {
  149 |     await targetApp.close();
  150 |   }
  151 | 
  152 |   const relaunched = await launch(target);
  153 |   try {
  154 |     const page = await relaunched.firstWindow();
  155 |     await page.getByTestId('virtual-grid').waitFor();
  156 |     await expect(page.getByTestId('statusbar-left')).toContainText(`${String(PHOTO_COUNT)} PHOTOS`);
  157 |     await expect(page.getByTestId('restore-onboarding')).not.toBeVisible();
  158 |     const restored = await page.evaluate<RecoverableSnapshot>(async () => {
  159 |       const api = (globalThis as unknown as { overlook: OverlookApi }).overlook;
  160 |       const { photos } = await api.library.page({ source: 'all', limit: 100 });
  161 |       const { albums } = await api.library.albums();
  162 |       const album = albums.find((candidate) => candidate.name === 'Recovery proof');
  163 |       if (album === undefined) throw new Error('restored album is missing');
  164 |       const members = await api.library.page({ source: 'all', albumId: album.id, limit: 100 });
  165 |       return {
  166 |         photos: photos.map(({ syncState: _syncState, ...recoverable }) => recoverable),
  167 |         albumId: album.id,
  168 |         albumPhotoIds: members.photos.map((photo) => photo.id),
  169 |       };
  170 |     });
  171 |     expect(restored).toEqual(expected);
  172 |     const first = restored.photos[0];
  173 |     expect(first).toBeDefined();
  174 |     const viewable = await page.evaluate<{ status: number; jpeg: boolean }>(`fetch('overlook-full://library/${first?.id ?? ''}').then(
  175 |       async (response) => {
  176 |         const bytes = new Uint8Array(await response.arrayBuffer());
  177 |         return { status: response.status, jpeg: bytes[0] === 0xff && bytes[1] === 0xd8 };
```