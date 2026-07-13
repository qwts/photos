import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  PCLOUD_CLIENT_ID,
  PCLOUD_REDIRECT_URI,
  PCloudOAuthError,
  buildAuthorizeUrl,
  normalizeApiHost,
  parseOAuthParams,
  redactTokens,
} from '../../src/main/backup/pcloud/oauth.js';

// #254: redirect parsing is the security boundary of the implicit flow —
// every branch (error passthrough, state nonce, missing token, region
// normalization, redaction) is pinned here without any network.

describe('pCloud OAuth helpers (#254)', () => {
  test('buildAuthorizeUrl carries the implicit-flow contract', () => {
    const url = new URL(buildAuthorizeUrl('nonce-1'));
    assert.equal(url.origin, 'https://my.pcloud.com');
    assert.equal(url.pathname, '/oauth2/authorize');
    assert.equal(url.searchParams.get('client_id'), PCLOUD_CLIENT_ID);
    assert.equal(url.searchParams.get('response_type'), 'token');
    assert.equal(url.searchParams.get('redirect_uri'), PCLOUD_REDIRECT_URI);
    assert.equal(url.searchParams.get('state'), 'nonce-1');
  });

  test('the registered redirect URI is exact: 127.0.0.1, port 41573, /callback', () => {
    // The pCloud console has this string registered; OAuth matching is
    // exact, so any drift here breaks connect for every install.
    assert.equal(PCLOUD_REDIRECT_URI, 'http://127.0.0.1:41573/callback');
  });

  test('happy path: token + hostname → result with normalized host', () => {
    const params = new URLSearchParams({ access_token: 'tok-1', state: 's', hostname: 'eapi.pcloud.com' });
    assert.deepEqual(parseOAuthParams(params, 's'), { accessToken: 'tok-1', apiHost: 'eapi.pcloud.com' });
  });

  test('missing hostname falls back to the US host', () => {
    const params = new URLSearchParams({ access_token: 'tok-1', state: 's' });
    assert.equal(parseOAuthParams(params, 's').apiHost, 'api.pcloud.com');
  });

  test('provider error param wins and is surfaced', () => {
    const params = new URLSearchParams({ error: 'access_denied', error_description: 'User denied.', state: 's' });
    assert.throws(
      () => parseOAuthParams(params, 's'),
      (error: unknown) => error instanceof PCloudOAuthError && error.message.includes('User denied.'),
    );
  });

  test('state mismatch rejects even with a valid token', () => {
    const params = new URLSearchParams({ access_token: 'tok-1', state: 'forged' });
    assert.throws(() => parseOAuthParams(params, 'expected'), /unexpected state/u);
  });

  test('missing or empty token rejects', () => {
    assert.throws(() => parseOAuthParams(new URLSearchParams({ state: 's' }), 's'), /did not return an access token/u);
    assert.throws(() => parseOAuthParams(new URLSearchParams({ state: 's', access_token: '' }), 's'), /did not return an access token/u);
  });

  test('normalizeApiHost: protocol/slash noise accepted, unknown hosts rejected', () => {
    assert.equal(normalizeApiHost('https://EAPI.pcloud.com/', 'api.pcloud.com'), 'eapi.pcloud.com');
    assert.equal(normalizeApiHost(null, 'eapi.pcloud.com'), 'eapi.pcloud.com');
    assert.equal(normalizeApiHost('  ', 'api.pcloud.com'), 'api.pcloud.com');
    assert.throws(() => normalizeApiHost('evil.example.com', 'api.pcloud.com'), PCloudOAuthError);
  });

  test('redactTokens scrubs tokens wherever they appear', () => {
    assert.equal(
      redactTokens('failed: access_token=SECRET123&state=s and ACCESS_TOKEN=OTHER#x'),
      'failed: access_token=redacted&state=s and access_token=redacted#x',
    );
  });
});
