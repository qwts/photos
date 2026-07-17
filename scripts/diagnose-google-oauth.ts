import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DIAGNOSTIC_REDIRECT_URI = 'http://127.0.0.1:49152';

type GoogleOAuthProbeClassification =
  'client-authentication-required' | 'client-authentication-rejected' | 'secretless-request-accepted' | 'inconclusive';

interface GoogleOAuthProbeResult {
  status: number;
  error: string;
  description: string;
  classification: GoogleOAuthProbeClassification;
  clientIdFingerprint: string;
}

function sanitize(value: string): string {
  return value
    .replace(/(access_token|refresh_token|code|code_verifier|client_secret)=([^&#\s]+)/giu, '$1=redacted')
    .replace(/Bearer\s+[^\s]+/giu, 'Bearer redacted')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 240);
}

export function classifyGoogleOAuthProbe(error: string, description: string): GoogleOAuthProbeClassification {
  const normalized = description.toLowerCase();
  if (error === 'invalid_request' && normalized.includes('client_secret') && normalized.includes('missing')) {
    return 'client-authentication-required';
  }
  if (error === 'invalid_client') return 'client-authentication-rejected';
  if (error === 'invalid_grant') return 'secretless-request-accepted';
  return 'inconclusive';
}

export async function probeGoogleOAuthClient(
  clientId: string,
  fetchImpl: typeof fetch = fetch,
  clientSecret?: string,
): Promise<GoogleOAuthProbeResult> {
  if (!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/u.test(clientId)) {
    throw new Error('OVERLOOK_GOOGLE_DRIVE_CLIENT_ID is missing or malformed');
  }
  const verifier = randomBytes(48).toString('base64url');
  const body = new URLSearchParams({
    client_id: clientId,
    code: 'overlook-diagnostic-invalid-authorization-code',
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: DIAGNOSTIC_REDIRECT_URI,
  });
  if (clientSecret !== undefined) body.set('client_secret', clientSecret);
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const rawPayload: unknown = await response.json().catch(() => ({}));
  const payload = typeof rawPayload === 'object' && rawPayload !== null ? (rawPayload as Record<string, unknown>) : {};
  const error = typeof payload['error'] === 'string' ? sanitize(payload['error']) : `HTTP ${String(response.status)}`;
  const description = typeof payload['error_description'] === 'string' ? sanitize(payload['error_description']) : '';
  return {
    status: response.status,
    error,
    description,
    classification: classifyGoogleOAuthProbe(error, description),
    clientIdFingerprint: createHash('sha256').update(clientId).digest('hex').slice(0, 12),
  };
}

async function main(): Promise<void> {
  const clientId = process.env['OVERLOOK_GOOGLE_DRIVE_CLIENT_ID']?.trim() ?? '';
  const secretlessResult = await probeGoogleOAuthClient(clientId);
  console.log('Google OAuth Desktop public-client probe');
  console.log(`client_id_sha256=${secretlessResult.clientIdFingerprint}`);
  console.log('request=authorization_code+PKCE, loopback root, client_secret absent, synthetic code (no consent or token)');
  console.log(`secretless.http_status=${String(secretlessResult.status)}`);
  console.log(`secretless.error=${secretlessResult.error}`);
  if (secretlessResult.description !== '') console.log(`secretless.error_description=${secretlessResult.description}`);
  console.log(`secretless.classification=${secretlessResult.classification}`);

  if (secretlessResult.classification === 'client-authentication-required') {
    const placeholderResult = await probeGoogleOAuthClient(clientId, fetch, 'overlook-diagnostic-not-a-real-secret');
    console.log('placeholder.request=identical request with a known-fake client_secret (no credential supplied)');
    console.log(`placeholder.http_status=${String(placeholderResult.status)}`);
    console.log(`placeholder.error=${placeholderResult.error}`);
    if (placeholderResult.description !== '') console.log(`placeholder.error_description=${placeholderResult.description}`);
    console.log(`placeholder.classification=${placeholderResult.classification}`);
    console.log(
      `conclusion=${
        placeholderResult.classification === 'client-authentication-rejected'
          ? 'token-endpoint-requires-valid-client-authentication-before-code-validation'
          : 'inconclusive'
      }`,
    );
  } else {
    console.log(
      `conclusion=${secretlessResult.classification === 'secretless-request-accepted' ? 'secretless-public-client-request-accepted' : 'inconclusive'}`,
    );
  }

  if (secretlessResult.classification !== 'secretless-request-accepted') process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
