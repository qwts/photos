import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { startGoogleDriveLoopbackCapture } from '../../src/main/backup/google-drive/loopback.js';
import { GoogleDriveOAuthError } from '../../src/main/backup/google-drive/oauth.js';

async function capture(overrides: { state?: string; timeoutMs?: number; requirePickedFiles?: boolean } = {}) {
  const state = overrides.state ?? 'nonce';
  const handle = startGoogleDriveLoopbackCapture({
    state,
    port: 0,
    timeoutMs: overrides.timeoutMs ?? 5000,
    ...(overrides.requirePickedFiles === undefined ? {} : { requirePickedFiles: overrides.requirePickedFiles }),
  });
  const listening = await handle.listening;
  return { handle, state, base: `http://127.0.0.1:${String(listening.port)}`, redirectUri: listening.redirectUri };
}

describe('Google Drive OAuth loopback (#277)', () => {
  test('a matching callback resolves the code and scrubs it from browser history', async () => {
    const { handle, base, redirectUri } = await capture();
    assert.equal(redirectUri, base);
    const response = await fetch(`${base}?code=code-1&state=nonce`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /history\.replaceState/u);
    assert.deepEqual(await handle.result, { code: 'code-1', pickedFileIds: [] });
  });

  test('wrong-state and unknown-path noise cannot settle the flow', async () => {
    const { handle, base } = await capture({ state: 'expected' });
    assert.equal((await fetch(`${base}/favicon.ico`)).status, 404);
    assert.equal((await fetch(`${base}?code=forged&state=wrong`)).status, 400);
    assert.equal((await fetch(`${base}?code=real&state=expected`)).status, 200);
    assert.deepEqual(await handle.result, { code: 'real', pickedFileIds: [] });
  });

  test('picker callbacks return bounded, unique Drive file IDs', async () => {
    const selected = await capture({ requirePickedFiles: true });
    assert.equal((await fetch(`${selected.base}?code=code-1&state=nonce&picked_file_ids=file_1,file-2,file_1`)).status, 200);
    assert.deepEqual(await selected.handle.result, { code: 'code-1', pickedFileIds: ['file_1', 'file-2'] });

    const missing = await capture({ requirePickedFiles: true });
    assert.equal((await fetch(`${missing.base}?code=code-1&state=nonce`)).status, 400);
    await assert.rejects(missing.handle.result, /returned no files/u);

    const forged = await capture({ requirePickedFiles: true });
    assert.equal((await fetch(`${forged.base}?code=code-1&state=nonce&picked_file_ids=good,%2Fetc%2Fpasswd`)).status, 400);
    await assert.rejects(forged.handle.result, /invalid selected file IDs/u);
  });

  test('provider error and missing code reject with no credential detail', async () => {
    const denied = await capture();
    assert.equal((await fetch(`${denied.base}?error=access_denied&state=nonce`)).status, 400);
    await assert.rejects(
      denied.handle.result,
      (error: unknown) => error instanceof GoogleDriveOAuthError && error.message.includes('access_denied'),
    );

    const missing = await capture();
    assert.equal((await fetch(`${missing.base}?state=nonce`)).status, 400);
    await assert.rejects(missing.handle.result, /did not return a code/u);
  });

  test('timeout and explicit close reject pending flows', async () => {
    const timed = await capture({ timeoutMs: 20 });
    await assert.rejects(timed.handle.result, /timed out/u);
    const closed = await capture();
    closed.handle.close();
    await assert.rejects(closed.handle.result, /cancelled/u);
  });
});
