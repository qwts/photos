import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { startGoogleDriveLoopbackCapture } from '../../src/main/backup/google-drive/loopback.js';
import { GoogleDriveOAuthError } from '../../src/main/backup/google-drive/oauth.js';

async function capture(overrides: { state?: string; timeoutMs?: number } = {}) {
  const state = overrides.state ?? 'nonce';
  const handle = startGoogleDriveLoopbackCapture({ state, port: 0, timeoutMs: overrides.timeoutMs ?? 5000 });
  const listening = await handle.listening;
  return { handle, state, base: `http://127.0.0.1:${String(listening.port)}`, redirectUri: listening.redirectUri };
}

describe('Google Drive OAuth loopback (#277)', () => {
  test('a matching callback resolves the code and scrubs it from browser history', async () => {
    const { handle, base, redirectUri } = await capture();
    assert.equal(redirectUri, `${base}/callback`);
    const response = await fetch(`${base}/callback?code=code-1&state=nonce`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /history\.replaceState/u);
    assert.equal(await handle.result, 'code-1');
  });

  test('wrong-state and unknown-path noise cannot settle the flow', async () => {
    const { handle, base } = await capture({ state: 'expected' });
    assert.equal((await fetch(`${base}/favicon.ico`)).status, 404);
    assert.equal((await fetch(`${base}/callback?code=forged&state=wrong`)).status, 400);
    assert.equal((await fetch(`${base}/callback?code=real&state=expected`)).status, 200);
    assert.equal(await handle.result, 'real');
  });

  test('provider error and missing code reject with no credential detail', async () => {
    const denied = await capture();
    assert.equal((await fetch(`${denied.base}/callback?error=access_denied&state=nonce`)).status, 400);
    await assert.rejects(
      denied.handle.result,
      (error: unknown) => error instanceof GoogleDriveOAuthError && error.message.includes('access_denied'),
    );

    const missing = await capture();
    assert.equal((await fetch(`${missing.base}/callback?state=nonce`)).status, 400);
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
