import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GoogleDriveAuthClient } from '../../src/main/backup/google-drive/auth-client.js';
import { createGoogleDriveConnect } from '../../src/main/backup/google-drive/connect.js';
import { GOOGLE_DRIVE_SCOPE } from '../../src/main/backup/google-drive/oauth.js';
import { GoogleDriveTokenStore } from '../../src/main/backup/google-drive/token-store.js';
import type { SafeStorageLike } from '../../src/main/crypto/keystore.js';

const CLIENT_ID = 'desktop.apps.googleusercontent.com';
const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value),
  decryptString: (value) => value.toString(),
};

let nextPort = 43_100;

function bodyText(body: RequestInit['body']): string {
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new Error('expected a string or URLSearchParams body');
}

function world(options: {
  clientId?: string | null;
  clientSecret?: string | null;
  browser: (url: URL, port: number) => Promise<void>;
  tokenResponse?: Response;
}) {
  const port = nextPort++;
  const tokenStore = new GoogleDriveTokenStore({ safeStorage, dataDir: mkdtempSync(join(tmpdir(), 'overlook-google-connect-')) });
  const clientId = options.clientId === undefined ? CLIENT_ID : options.clientId;
  let tokenRequest = '';
  const fetchImpl: typeof fetch = (_input, init) => {
    tokenRequest = bodyText(init?.body);
    return Promise.resolve(
      options.tokenResponse ??
        new Response(
          JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, scope: GOOGLE_DRIVE_SCOPE }),
          {
            status: 200,
          },
        ),
    );
  };
  const clientSecret = options.clientSecret ?? null;
  const authClient = new GoogleDriveAuthClient({ clientId: () => clientId, clientSecret: () => clientSecret, tokenStore, fetchImpl });
  let connected = 0;
  const connect = createGoogleDriveConnect({
    clientId: () => clientId,
    clientSecret: () => clientSecret,
    tokenStore,
    authClient,
    openExternal: (url) => options.browser(new URL(url), port),
    onConnected: () => {
      connected += 1;
      assert.notEqual(tokenStore.load(), null, 'selection flips only after sealed custody exists');
    },
    fetchImpl,
    port,
    timeoutMs: 5000,
  });
  return { connect, tokenStore, authClient, connected: () => connected, tokenRequest: () => new URLSearchParams(tokenRequest) };
}

describe('Google Drive connect flow (#277)', () => {
  test('system-browser PKCE handshake seals the refresh token then connects', async () => {
    const state = world({
      clientSecret: 'desktop-secret',
      browser: async (url, port) => {
        assert.equal(url.searchParams.get('scope'), GOOGLE_DRIVE_SCOPE);
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
        await fetch(`http://127.0.0.1:${String(port)}?code=code-1&state=${url.searchParams.get('state') ?? ''}`);
      },
    });
    assert.deepEqual(await state.connect(), { ok: true, reason: null });
    assert.deepEqual(state.tokenStore.load(), {
      clientId: CLIENT_ID,
      refreshToken: 'refresh-1',
      connectedAt: state.tokenStore.load()?.connectedAt,
    });
    assert.equal(state.connected(), 1);
    assert.equal(state.tokenRequest().get('client_secret'), 'desktop-secret');
    assert.equal(await state.authClient.accessToken(), 'access-1', 'the exchanged access token is seeded in memory');
  });

  test('unconfigured builds and denied exchanges do not write custody or flip selection', async () => {
    const unavailable = world({ clientId: null, browser: () => Promise.resolve() });
    assert.deepEqual(await unavailable.connect(), { ok: false, reason: 'Google Drive is not configured in this build.' });
    const denied = world({
      browser: async (url, port) => {
        await fetch(`http://127.0.0.1:${String(port)}?code=SECRET&state=${url.searchParams.get('state') ?? ''}`);
      },
      tokenResponse: new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    });
    const result = await denied.connect();
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.reason ?? '', /SECRET/u);
    assert.equal(denied.tokenStore.load(), null);
    assert.equal(denied.connected(), 0);
  });

  test('only one browser flow runs at a time and failure releases the listener', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = world({
      browser: async () => {
        await gate;
        throw new Error('browser abandoned');
      },
    });
    const first = state.connect();
    assert.deepEqual(await state.connect(), {
      ok: false,
      reason: 'A Google Drive sign-in is already in progress — finish it in the browser.',
    });
    release?.();
    assert.equal((await first).ok, false);
    assert.equal((await state.connect()).ok, false, 'the fixed loopback port can be rebound after failure');
  });
});
