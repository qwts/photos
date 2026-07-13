// pCloud OAuth helpers (#254): the IMPLICIT flow (`response_type=token`) —
// no client secret, so nothing secret ships in the app. Ported patterns from
// the working image-trail integration (ADR-0007's interop precedent): merged
// query/fragment params, state-nonce validation, hostname-based region, and
// token-redacting error messages. Electron-free so node:test covers every
// branch without a browser.

export const PCLOUD_CLIENT_ID = 'VWeu9fyM9kHP80KGmRvBa8Aej8UX';

// Registered verbatim in the owner's pCloud app console — exact-match, so
// 127.0.0.1 (not localhost), this port, this path.
export const PCLOUD_LOOPBACK_PORT = 41573;
export const PCLOUD_REDIRECT_URI = `http://127.0.0.1:${String(PCLOUD_LOOPBACK_PORT)}/callback`;

const PCLOUD_AUTHORIZE_URL = 'https://my.pcloud.com/oauth2/authorize';

/** pCloud is region-sharded; the authorize redirect names the account's API
 * host so the client never has to ask the user. */
export type PCloudApiHost = 'api.pcloud.com' | 'eapi.pcloud.com';

export class PCloudOAuthError extends Error {
  override readonly name = 'PCloudOAuthError';
}

/** Tokens must never reach logs or error UI — scrub before throwing. */
export function redactTokens(message: string): string {
  return message.replace(/access_token=[^&#\s]+/giu, 'access_token=redacted');
}

export function buildAuthorizeUrl(state: string): string {
  const url = new URL(PCLOUD_AUTHORIZE_URL);
  url.searchParams.set('client_id', PCLOUD_CLIENT_ID);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('redirect_uri', PCLOUD_REDIRECT_URI);
  url.searchParams.set('state', state);
  return url.toString();
}

export function normalizeApiHost(hostname: string | null, fallback: PCloudApiHost): PCloudApiHost {
  if (hostname === null || hostname.trim() === '') {
    return fallback;
  }
  const bare = hostname
    .trim()
    .replace(/^https?:\/\//iu, '')
    .replace(/\/+$/u, '')
    .toLowerCase();
  if (bare === 'api.pcloud.com' || bare === 'eapi.pcloud.com') {
    return bare;
  }
  throw new PCloudOAuthError('pCloud API host must be api.pcloud.com or eapi.pcloud.com.');
}

export interface PCloudOAuthResult {
  readonly accessToken: string;
  readonly apiHost: PCloudApiHost;
}

/** Validates the redirect's merged query/fragment params. The relay page
 * forwards `location.hash` (implicit puts the token in the fragment), but
 * provider errors can arrive in the query — callers merge both. */
export function parseOAuthParams(params: URLSearchParams, expectedState: string): PCloudOAuthResult {
  const error = params.get('error');
  if (error !== null) {
    const description = params.get('error_description');
    throw new PCloudOAuthError(redactTokens(`pCloud authorization failed: ${description ?? error}`));
  }
  if (params.get('state') !== expectedState) {
    throw new PCloudOAuthError('pCloud authorization returned an unexpected state.');
  }
  const accessToken = params.get('access_token');
  if (accessToken === null || accessToken === '') {
    throw new PCloudOAuthError('pCloud authorization did not return an access token.');
  }
  return { accessToken, apiHost: normalizeApiHost(params.get('hostname'), 'api.pcloud.com') };
}
