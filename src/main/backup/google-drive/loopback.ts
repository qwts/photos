import { createServer } from 'node:http';

import { GoogleDriveOAuthError, redactGoogleCredentials } from './oauth.js';

const SUCCESS_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Overlook — Google Drive complete</title>
<body style="font-family: system-ui; display: grid; place-items: center; min-height: 80vh">
<p>Done — you can close this tab and return to Overlook.</p>
<script>history.replaceState(null, '', '/')</script>
</body>`;

export interface GoogleDriveLoopbackCapture {
  readonly listening: Promise<{ port: number; redirectUri: string }>;
  readonly result: Promise<{ readonly code: string; readonly pickedFileIds: readonly string[] }>;
  close(): void;
}

const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{1,256}$/u;

function pickedFileIds(url: URL): string[] | null {
  const raw = url.searchParams.get('picked_file_ids');
  if (raw === null || raw === '') return [];
  const ids = [...new Set(raw.split(','))];
  if (ids.length > 500 || ids.some((id) => !DRIVE_FILE_ID.test(id))) return null;
  return ids;
}

type ParsedCallback =
  | { readonly ok: true; readonly result: { readonly code: string; readonly pickedFileIds: readonly string[] } }
  | { readonly ok: false; readonly message: string; readonly error: GoogleDriveOAuthError | null };

function parseCallback(url: URL, state: string, requirePickedFiles: boolean): ParsedCallback {
  if (url.searchParams.get('state') !== state) return { ok: false, message: 'Invalid authorization state.', error: null };
  const providerError = url.searchParams.get('error');
  if (providerError !== null) {
    return {
      ok: false,
      message: 'Google Drive connection failed. Return to Overlook and try again.',
      error: new GoogleDriveOAuthError(`Google Drive authorization failed: ${providerError}`),
    };
  }
  const code = url.searchParams.get('code');
  if (code === null || code === '') {
    return {
      ok: false,
      message: 'Google Drive did not return an authorization code.',
      error: new GoogleDriveOAuthError('Google Drive authorization did not return a code.'),
    };
  }
  const selected = pickedFileIds(url);
  if (selected === null) {
    return {
      ok: false,
      message: 'Google Drive returned an invalid file selection.',
      error: new GoogleDriveOAuthError('Google Drive returned invalid selected file IDs.'),
    };
  }
  if (requirePickedFiles && selected.length === 0) {
    return {
      ok: false,
      message: 'No Google Drive files were selected.',
      error: new GoogleDriveOAuthError('Google Drive selection returned no files.'),
    };
  }
  return { ok: true, result: { code, pickedFileIds: selected } };
}

/** Desktop installed-app callback. A random loopback port avoids fixed-port
 * collisions; only the matching state nonce can settle the pending flow. */
export function startGoogleDriveLoopbackCapture(options: {
  readonly state: string;
  readonly port?: number;
  readonly timeoutMs?: number;
  readonly requirePickedFiles?: boolean;
}): GoogleDriveLoopbackCapture {
  const requestedPort = options.port ?? 0;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  let settled = false;
  let resolveResult: (result: { readonly code: string; readonly pickedFileIds: readonly string[] }) => void;
  let rejectResult: (error: Error) => void;
  const result = new Promise<{ readonly code: string; readonly pickedFileIds: readonly string[] }>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  result.catch(() => undefined);

  function settle(
    outcome: { ok: true; result: { readonly code: string; readonly pickedFileIds: readonly string[] } } | { ok: false; error: Error },
  ): void {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    setImmediate(() => server.close());
    if (outcome.ok) resolveResult(outcome.result);
    else rejectResult(outcome.error);
  }

  const timer = setTimeout(() => {
    settle({ ok: false, error: new GoogleDriveOAuthError('Google Drive authorization timed out.') });
  }, timeoutMs);

  const server = createServer((request, response) => {
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : requestedPort;
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${String(port)}`);
    if (url.pathname !== '/') {
      response.writeHead(404).end();
      return;
    }
    if (settled) {
      response.writeHead(409).end();
      return;
    }
    const callback = parseCallback(url, options.state, options.requirePickedFiles === true);
    if (!callback.ok) {
      response.writeHead(400).end(callback.message);
      if (callback.error !== null) settle({ ok: false, error: callback.error });
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(SUCCESS_PAGE);
    settle({ ok: true, result: callback.result });
  });

  const listening = new Promise<{ port: number; redirectUri: string }>((resolve, reject) => {
    server.once('error', (error: Error) => {
      const wrapped = new GoogleDriveOAuthError(redactGoogleCredentials(`Google Drive sign-in listener failed: ${error.message}`));
      reject(wrapped);
      settle({ ok: false, error: wrapped });
    });
    server.listen(requestedPort, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : requestedPort;
      resolve({ port, redirectUri: `http://127.0.0.1:${String(port)}` });
    });
  });
  listening.catch(() => undefined);

  return {
    listening,
    result,
    close: () => settle({ ok: false, error: new GoogleDriveOAuthError('Google Drive authorization was cancelled.') }),
  };
}
