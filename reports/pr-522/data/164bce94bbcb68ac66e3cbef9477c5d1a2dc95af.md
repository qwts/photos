# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: restore-cloud.spec.ts >> corrupt only-generation blob fails without publishing a library (#291)
- Location: tests/e2e/restore-cloud.spec.ts:222:1

# Error details

```
Error: expect(received).toBeNull()

Received: {"message": "No Overlook cloud libraries were found.", "reason": "corrupt"}
```

# Test source

```ts
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
  178 |       },
  179 |     )`);
  180 |     expect(viewable).toEqual({ status: 200, jpeg: true });
  181 |   } finally {
  182 |     await relaunched.close();
  183 |   }
  184 | });
  185 | 
  186 | test('corrupt newest manifest falls back and reports the rejected generation (#291)', async () => {
  187 |   const source = mkdtempSync(join(tmpdir(), 'overlook-e2e-fallback-source-'));
  188 |   const target = mkdtempSync(join(tmpdir(), 'overlook-e2e-fallback-target-'));
  189 |   const keyPath = join(mkdtempSync(join(tmpdir(), 'overlook-e2e-fallback-key-')), 'overlook-recovery.key');
  190 |   await backupSimpleSource(source, keyPath);
  191 |   cpSync(join(source, 'mock-remote'), join(target, 'mock-remote'), { recursive: true });
  192 |   const remote = join(target, 'mock-remote');
  193 |   const validGeneration = highestManifestGeneration(remote);
  194 |   const rejectedGeneration = validGeneration + 1;
  195 |   writeFileSync(join(remote, 'manifest', `gen-${String(rejectedGeneration)}.ovlk`), 'corrupt newest manifest');
  196 | 
  197 |   const app = await launch(target, { OVERLOOK_KEY_IMPORT_SOURCE: keyPath, OVERLOOK_RESTORE_NO_RELAUNCH: '1' });
  198 |   try {
  199 |     const page = await app.firstWindow();
  200 |     const response = await page.evaluate(
  201 |       async ({ recoveryKeyPath, password }) => {
  202 |         const api = (globalThis as unknown as { overlook: OverlookApi }).overlook;
  203 |         const discovered = await api.restore.discover({ providerId: 'mock', keyPath: recoveryKeyPath, password });
  204 |         const library = discovered.libraries.find((candidate) => candidate.validation === 'valid');
  205 |         if (discovered.sessionId === null || library === undefined) return { discovery: discovered, restored: null };
  206 |         const restored = await api.restore.run({ sessionId: discovered.sessionId, libraryId: library.libraryId, allowReplace: false });
  207 |         return { discovery: discovered, restored };
  208 |       },
  209 |       { recoveryKeyPath: keyPath, password: PASSWORD },
  210 |     );
  211 |     expect(response.discovery.error).toBeNull();
  212 |     expect(response.restored).toMatchObject({
  213 |       error: null,
  214 |       result: { generation: validGeneration, fallbackFromGeneration: rejectedGeneration },
  215 |     });
  216 |     expect(existsSync(join(target, 'library', 'library.db'))).toBe(true);
  217 |   } finally {
  218 |     await app.close();
  219 |   }
  220 | });
  221 | 
  222 | test('corrupt only-generation blob fails without publishing a library (#291)', async () => {
  223 |   const source = mkdtempSync(join(tmpdir(), 'overlook-e2e-corrupt-source-'));
  224 |   const target = mkdtempSync(join(tmpdir(), 'overlook-e2e-corrupt-target-'));
  225 |   const keyPath = join(mkdtempSync(join(tmpdir(), 'overlook-e2e-corrupt-key-')), 'overlook-recovery.key');
  226 |   const hashes = await backupSimpleSource(source, keyPath);
  227 |   cpSync(join(source, 'mock-remote'), join(target, 'mock-remote'), { recursive: true });
  228 |   const firstHash = hashes[0];
  229 |   expect(firstHash).toBeDefined();
  230 |   writeFileSync(join(target, 'mock-remote', 'blobs', firstHash?.slice(0, 2) ?? '', firstHash ?? ''), 'corrupt blob');
  231 | 
  232 |   const app = await launch(target, { OVERLOOK_KEY_IMPORT_SOURCE: keyPath, OVERLOOK_RESTORE_NO_RELAUNCH: '1' });
  233 |   try {
  234 |     const page = await app.firstWindow();
  235 |     const response = await page.evaluate(
  236 |       async ({ recoveryKeyPath, password }) => {
  237 |         const api = (globalThis as unknown as { overlook: OverlookApi }).overlook;
  238 |         const discovered = await api.restore.discover({ providerId: 'mock', keyPath: recoveryKeyPath, password });
  239 |         if (discovered.error !== null || discovered.sessionId === null) return { discoveryError: discovered.error, run: null };
  240 |         const library = discovered.libraries.find((candidate) => candidate.validation === 'valid');
  241 |         if (library === undefined) return { discoveryError: { reason: 'corrupt', message: 'no valid library' }, run: null };
  242 |         return {
  243 |           discoveryError: null,
  244 |           run: await api.restore.run({ sessionId: discovered.sessionId, libraryId: library.libraryId, allowReplace: false }),
  245 |         };
  246 |       },
  247 |       { recoveryKeyPath: keyPath, password: PASSWORD },
  248 |     );
> 249 |     expect(response.discoveryError).toBeNull();
      |                                     ^ Error: expect(received).toBeNull()
  250 |     expect(response.run?.result).toBeNull();
  251 |     expect(response.run?.error).toMatchObject({ reason: 'corrupt' });
  252 |     expect(existsSync(join(target, 'library', 'library.db'))).toBe(false);
  253 |   } finally {
  254 |     await app.close();
  255 |   }
  256 | });
  257 | 
  258 | test('activation failure rolls the existing library back through the full restore path (#291)', async () => {
  259 |   const source = mkdtempSync(join(tmpdir(), 'overlook-e2e-rollback-source-'));
  260 |   const target = mkdtempSync(join(tmpdir(), 'overlook-e2e-rollback-target-'));
  261 |   const keyPath = join(mkdtempSync(join(tmpdir(), 'overlook-e2e-rollback-key-')), 'overlook-recovery.key');
  262 |   const restoredHashes = await backupSimpleSource(source, keyPath);
  263 | 
  264 |   const targetSetup = await launch(target, { OVERLOOK_SEED: '1' });
  265 |   let activeHashes: readonly string[];
  266 |   try {
  267 |     const page = await targetSetup.firstWindow();
  268 |     await page.getByTestId('virtual-grid').waitFor();
  269 |     activeHashes = await page.evaluate(async () => {
  270 |       const api = (globalThis as unknown as { overlook: OverlookApi }).overlook;
  271 |       return (await api.library.page({ source: 'all', limit: 100 })).photos.map((photo) => photo.contentHash);
  272 |     });
  273 |   } finally {
  274 |     await targetSetup.close();
  275 |   }
  276 |   expect(activeHashes).toHaveLength(1);
  277 |   rmSync(join(target, 'mock-remote'), { recursive: true, force: true });
  278 |   cpSync(join(source, 'mock-remote'), join(target, 'mock-remote'), { recursive: true });
  279 | 
  280 |   const failing = await launch(target, {
  281 |     OVERLOOK_KEY_IMPORT_SOURCE: keyPath,
  282 |     OVERLOOK_RESTORE_FAULT: 'activation',
  283 |     OVERLOOK_RESTORE_NO_RELAUNCH: '1',
  284 |   });
  285 |   try {
  286 |     const page = await failing.firstWindow();
  287 |     await page.getByTestId('virtual-grid').waitFor();
  288 |     const response = await page.evaluate(
  289 |       async ({ recoveryKeyPath, password }) => {
  290 |         const api = (globalThis as unknown as { overlook: OverlookApi }).overlook;
  291 |         const discovered = await api.restore.discover({ providerId: 'mock', keyPath: recoveryKeyPath, password });
  292 |         const library = discovered.libraries.find((candidate) => candidate.validation === 'valid');
  293 |         if (discovered.sessionId === null || library === undefined) return null;
  294 |         return api.restore.run({ sessionId: discovered.sessionId, libraryId: library.libraryId, allowReplace: true });
  295 |       },
  296 |       { recoveryKeyPath: keyPath, password: PASSWORD },
  297 |     );
  298 |     expect(response?.result).toBeNull();
  299 |     expect(response?.error).toMatchObject({ reason: 'io', message: 'injected activation failure' });
  300 |   } finally {
  301 |     await failing.close();
  302 |   }
  303 | 
  304 |   expect(existsSync(join(target, 'library.restore-previous'))).toBe(false);
  305 |   expect(existsSync(join(target, 'library.restore-staging', 'library.db'))).toBe(true);
  306 |   const relaunched = await launch(target);
  307 |   try {
  308 |     const page = await relaunched.firstWindow();
  309 |     await page.getByTestId('virtual-grid').waitFor();
  310 |     const currentHashes = await page.evaluate(async () => {
  311 |       const api = (globalThis as unknown as { overlook: OverlookApi }).overlook;
  312 |       return (await api.library.page({ source: 'all', limit: 100 })).photos.map((photo) => photo.contentHash);
  313 |     });
  314 |     expect(currentHashes).toEqual(activeHashes);
  315 |     expect(currentHashes).not.toEqual(restoredHashes);
  316 |   } finally {
  317 |     await relaunched.close();
  318 |   }
  319 | });
  320 | 
```