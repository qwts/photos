import { createHash, randomBytes } from 'node:crypto';

export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export class GoogleDriveOAuthError extends Error {
  override readonly name = 'GoogleDriveOAuthError';
}

export function redactGoogleCredentials(message: string): string {
  return message
    .replace(/(access_token|refresh_token|code|code_verifier)=([^&#\s]+)/giu, '$1=redacted')
    .replace(/Bearer\s+[^\s]+/giu, 'Bearer redacted');
}

function base64Url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(48));
  return { verifier, challenge: base64Url(createHash('sha256').update(verifier, 'ascii').digest()) };
}

export function buildGoogleDriveAuthorizeUrl(options: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly challenge: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_DRIVE_SCOPE);
  url.searchParams.set('state', options.state);
  url.searchParams.set('code_challenge', options.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  // A user can clear local custody without revoking the Google grant. Consent
  // ensures reconnect receives a fresh refresh token in that case.
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

interface TokenResponse {
  readonly access_token?: unknown;
  readonly expires_in?: unknown;
  readonly refresh_token?: unknown;
  readonly scope?: unknown;
}

export async function exchangeGoogleDriveCode(options: {
  readonly clientId: string;
  readonly code: string;
  readonly verifier: string;
  readonly redirectUri: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<{ refreshToken: string; accessToken: string; expiresIn: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: options.clientId,
        code: options.code,
        code_verifier: options.verifier,
        grant_type: 'authorization_code',
        redirect_uri: options.redirectUri,
      }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'network failure';
    throw new GoogleDriveOAuthError(redactGoogleCredentials(`Google Drive token exchange failed: ${detail}`));
  }
  const data = (await response.json().catch(() => ({}))) as TokenResponse & { readonly error?: unknown };
  if (!response.ok) {
    const reason = typeof data.error === 'string' ? data.error : `HTTP ${String(response.status)}`;
    throw new GoogleDriveOAuthError(redactGoogleCredentials(`Google Drive token exchange failed: ${reason}`));
  }
  const scopes = typeof data.scope === 'string' ? new Set(data.scope.split(/\s+/u)) : null;
  if (scopes !== null && !scopes.has(GOOGLE_DRIVE_SCOPE)) {
    throw new GoogleDriveOAuthError('Google Drive authorization did not grant the required drive.file scope.');
  }
  if (typeof data.refresh_token !== 'string' || data.refresh_token === '') {
    throw new GoogleDriveOAuthError('Google Drive authorization did not return a refresh token.');
  }
  if (typeof data.access_token !== 'string' || data.access_token === '') {
    throw new GoogleDriveOAuthError('Google Drive authorization did not return an access token.');
  }
  const expiresIn = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600;
  return { refreshToken: data.refresh_token, accessToken: data.access_token, expiresIn };
}
