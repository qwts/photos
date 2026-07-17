import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GOOGLE_DRIVE_SCOPE,
  GoogleDriveOAuthError,
  buildGoogleDriveAuthorizeUrl,
  createPkce,
  exchangeGoogleDriveCode,
  redactGoogleCredentials,
} from '../../src/main/backup/google-drive/oauth.js';

const CLIENT_ID = 'desktop.apps.googleusercontent.com';

function bodyText(body: RequestInit['body']): string {
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new Error('expected a string or URLSearchParams body');
}

describe('Google Drive OAuth helpers (#277)', () => {
  test('PKCE and authorization URL use the desktop loopback drive.file contract', () => {
    const pkce = createPkce();
    assert.match(pkce.verifier, /^[A-Za-z0-9_-]{43,128}$/u);
    assert.match(pkce.challenge, /^[A-Za-z0-9_-]{43}$/u);
    const url = new URL(
      buildGoogleDriveAuthorizeUrl({
        clientId: CLIENT_ID,
        redirectUri: 'http://127.0.0.1:43210',
        state: 'nonce',
        challenge: pkce.challenge,
      }),
    );
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:43210');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('scope'), GOOGLE_DRIVE_SCOPE);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('prompt'), 'consent');
  });

  test('authorization code exchange omits an unconfigured client secret and accepts the required scope', async () => {
    let body = '';
    const fetchImpl: typeof fetch = (_input, init) => {
      body = bodyText(init?.body);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'access-1',
            refresh_token: 'refresh-1',
            expires_in: 1800,
            scope: GOOGLE_DRIVE_SCOPE,
          }),
          { status: 200 },
        ),
      );
    };
    const result = await exchangeGoogleDriveCode({
      clientId: CLIENT_ID,
      code: 'code-1',
      verifier: 'verifier-1',
      redirectUri: 'http://127.0.0.1:1',
      fetchImpl,
    });
    assert.deepEqual(result, { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 1800 });
    const params = new URLSearchParams(body);
    assert.equal(params.get('client_id'), CLIENT_ID);
    assert.equal(params.get('code'), 'code-1');
    assert.equal(params.get('code_verifier'), 'verifier-1');
    assert.equal(params.get('client_secret'), null);
  });

  test('desktop Picker keeps drive.file and enables explicit multi-selection', () => {
    const url = new URL(
      buildGoogleDriveAuthorizeUrl({
        clientId: CLIENT_ID,
        redirectUri: 'http://127.0.0.1:43210',
        state: 'nonce',
        challenge: 'challenge',
        picker: true,
      }),
    );
    assert.equal(url.searchParams.get('scope'), GOOGLE_DRIVE_SCOPE);
    assert.equal(url.searchParams.get('trigger_onepick'), 'true');
    assert.equal(url.searchParams.get('allow_multiple'), 'true');
  });

  test('authorization code exchange includes the issued Desktop client credential when configured', async () => {
    let body = '';
    await exchangeGoogleDriveCode({
      clientId: CLIENT_ID,
      clientSecret: 'desktop-secret',
      code: 'code-1',
      verifier: 'verifier-1',
      redirectUri: 'http://127.0.0.1:1',
      fetchImpl: (_input, init) => {
        body = bodyText(init?.body);
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1', scope: GOOGLE_DRIVE_SCOPE }), {
            status: 200,
          }),
        );
      },
    });
    assert.equal(new URLSearchParams(body).get('client_secret'), 'desktop-secret');
  });

  test('token response validation rejects missing grants and credentials', async () => {
    const exchange = (payload: object) =>
      exchangeGoogleDriveCode({
        clientId: CLIENT_ID,
        code: 'code',
        verifier: 'verifier',
        redirectUri: 'http://127.0.0.1:1',
        fetchImpl: () => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 })),
      });
    await assert.rejects(exchange({ access_token: 'a', refresh_token: 'r', scope: 'other' }), /drive\.file scope/u);
    await assert.rejects(exchange({ access_token: 'a', scope: GOOGLE_DRIVE_SCOPE }), /refresh token/u);
    assert.deepEqual(
      await exchangeGoogleDriveCode({
        clientId: CLIENT_ID,
        code: 'code',
        verifier: 'verifier',
        redirectUri: 'http://127.0.0.1:1',
        requireRefreshToken: false,
        fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ access_token: 'a', scope: GOOGLE_DRIVE_SCOPE }), { status: 200 })),
      }),
      { accessToken: 'a', refreshToken: null, expiresIn: 3600 },
    );
    await assert.rejects(exchange({ refresh_token: 'r', scope: GOOGLE_DRIVE_SCOPE }), /access token/u);
    assert.equal((await exchange({ access_token: 'a', refresh_token: 'r' })).expiresIn, 3600);
  });

  test('HTTP and network failures are redacted', async () => {
    await assert.rejects(
      exchangeGoogleDriveCode({
        clientId: CLIENT_ID,
        code: 'secret',
        verifier: 'verifier',
        redirectUri: 'http://127.0.0.1:1',
        fetchImpl: () =>
          Promise.resolve(
            new Response(JSON.stringify({ error: 'invalid_request', error_description: 'client_secret is missing.' }), { status: 400 }),
          ),
      }),
      (error: unknown) => error instanceof GoogleDriveOAuthError && /invalid_request: client_secret is missing\./u.test(error.message),
    );
    await assert.rejects(
      exchangeGoogleDriveCode({
        clientId: CLIENT_ID,
        code: 'secret',
        verifier: 'verifier',
        redirectUri: 'http://127.0.0.1:1',
        fetchImpl: () => Promise.reject(new Error('access_token=SECRET')),
      }),
      (error: unknown) => error instanceof GoogleDriveOAuthError && !error.message.includes('SECRET'),
    );
    assert.equal(
      redactGoogleCredentials('access_token=A refresh_token=R client_secret=S code=C code_verifier=V Bearer TOKEN'),
      'access_token=redacted refresh_token=redacted client_secret=redacted code=redacted code_verifier=redacted Bearer redacted',
    );
  });

  test('provider descriptions are redacted, normalized, and bounded', async () => {
    await assert.rejects(
      exchangeGoogleDriveCode({
        clientId: CLIENT_ID,
        code: 'secret',
        verifier: 'verifier',
        redirectUri: 'http://127.0.0.1:1',
        fetchImpl: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                error: 'invalid_request',
                error_description: `access_token=SECRET\n${'x'.repeat(300)}`,
              }),
              { status: 400 },
            ),
          ),
      }),
      (error: unknown) =>
        error instanceof GoogleDriveOAuthError &&
        !error.message.includes('SECRET') &&
        !error.message.includes('\n') &&
        error.message.length <= 'Google Drive token exchange failed: invalid_request: '.length + 240,
    );
  });
});
