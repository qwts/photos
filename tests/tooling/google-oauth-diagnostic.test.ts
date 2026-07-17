import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyGoogleOAuthProbe, probeGoogleOAuthClient } from '../../scripts/diagnose-google-oauth.js';

const CLIENT_ID = 'desktop.apps.googleusercontent.com';

describe('Google OAuth public-client diagnostic (#443)', () => {
  test('classifies token-service client authentication before code validation', () => {
    assert.equal(classifyGoogleOAuthProbe('invalid_request', 'client_secret is missing.'), 'client-authentication-required');
    assert.equal(classifyGoogleOAuthProbe('invalid_client', 'The OAuth client was not found.'), 'client-authentication-rejected');
    assert.equal(classifyGoogleOAuthProbe('invalid_grant', 'Bad Request'), 'secretless-request-accepted');
    assert.equal(classifyGoogleOAuthProbe('temporarily_unavailable', ''), 'inconclusive');
  });

  test('uses a synthetic code, valid PKCE shape, root loopback, and no client secret', async () => {
    let requestBody = '';
    const result = await probeGoogleOAuthClient(CLIENT_ID, (_input, init) => {
      requestBody = init?.body instanceof URLSearchParams ? init.body.toString() : '';
      return Promise.resolve(new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Bad Request' }), { status: 400 }));
    });
    const body = new URLSearchParams(requestBody);

    assert.equal(body.get('client_id'), CLIENT_ID);
    assert.equal(body.get('code'), 'overlook-diagnostic-invalid-authorization-code');
    assert.match(body.get('code_verifier') ?? '', /^[A-Za-z0-9_-]{64}$/u);
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('redirect_uri'), 'http://127.0.0.1:49152');
    assert.equal(body.get('client_secret'), null);
    assert.equal(result.classification, 'secretless-request-accepted');
  });

  test('rejects malformed client IDs before making a network request', async () => {
    let called = false;
    await assert.rejects(
      probeGoogleOAuthClient('not-a-google-client', () => {
        called = true;
        return Promise.resolve(new Response('{}'));
      }),
      /missing or malformed/u,
    );
    assert.equal(called, false);
  });

  test('only includes the explicitly supplied placeholder secret', async () => {
    let requestBody = '';
    const result = await probeGoogleOAuthClient(
      CLIENT_ID,
      (_input, init) => {
        requestBody = init?.body instanceof URLSearchParams ? init.body.toString() : '';
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'invalid_client', error_description: 'The OAuth client was not found.' }), {
            status: 401,
          }),
        );
      },
      'known-fake-placeholder',
    );

    assert.equal(new URLSearchParams(requestBody).get('client_secret'), 'known-fake-placeholder');
    assert.equal(result.classification, 'client-authentication-rejected');
  });
});
