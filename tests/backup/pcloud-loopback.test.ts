import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { startLoopbackCapture } from '../../src/main/backup/pcloud/loopback.js';
import { PCloudOAuthError } from '../../src/main/backup/pcloud/oauth.js';

// #254: the loopback listener exercised over real HTTP on an ephemeral port
// — the same requests the system browser and the relay page's fetch make.

async function capture(overrides?: { state?: string; timeoutMs?: number }) {
  const state = overrides?.state ?? 'nonce';
  const handle = startLoopbackCapture({ state, port: 0, timeoutMs: overrides?.timeoutMs ?? 5_000 });
  const port = await handle.listening;
  return { handle, state, base: `http://127.0.0.1:${String(port)}` };
}

describe('pCloud loopback capture (#254)', () => {
  test('EXIT CRITERIA: browser lands on /callback, relay posts the fragment, token resolves', async () => {
    const { handle, base } = await capture();

    const page = await fetch(`${base}/callback#access_token=tok-1&state=nonce`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /location\.hash/u, 'the relay page forwards the fragment (the token never hits the server URL)');

    // What the relay script does with location.hash:
    const posted = await fetch(`${base}/capture?access_token=tok-1&state=nonce&hostname=eapi.pcloud.com`);
    assert.equal(posted.status, 204);
    assert.deepEqual(await handle.result, { accessToken: 'tok-1', apiHost: 'eapi.pcloud.com' });
  });

  test('provider error rejects the flow and answers 400', async () => {
    const { handle, base } = await capture();
    const posted = await fetch(`${base}/capture?error=access_denied&state=nonce`);
    assert.equal(posted.status, 400);
    await assert.rejects(handle.result, (error: unknown) => error instanceof PCloudOAuthError && error.message.includes('access_denied'));
  });

  test('a forged state never resolves a token', async () => {
    const { handle, base } = await capture({ state: 'expected' });
    const posted = await fetch(`${base}/capture?access_token=tok-1&state=forged`);
    assert.equal(posted.status, 400);
    await assert.rejects(handle.result, /unexpected state/u);
  });

  test('single-shot: a second capture after settling gets 409', async () => {
    const { handle, base } = await capture();
    await fetch(`${base}/capture?access_token=tok-1&state=nonce`);
    await handle.result;
    const replay = await fetch(`${base}/capture?access_token=tok-2&state=nonce`).catch(() => null);
    // The server is closing; either the connection is refused or it answers
    // 409 — both mean the replay took nothing.
    assert.ok(replay === null || replay.status === 409);
  });

  test('unknown paths 404 without settling the flow', async () => {
    const { handle, base } = await capture();
    const stray = await fetch(`${base}/favicon.ico`);
    assert.equal(stray.status, 404);
    handle.close();
    await assert.rejects(handle.result, /cancelled/u);
  });

  test('timeout rejects', async () => {
    const { handle } = await capture({ timeoutMs: 30 });
    await assert.rejects(handle.result, /timed out/u);
  });

  test('close() cancels a pending flow', async () => {
    const { handle } = await capture();
    handle.close();
    await assert.rejects(handle.result, /cancelled/u);
  });
});
