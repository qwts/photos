import { createServer } from 'node:http';

import { GoogleDriveOAuthError, redactGoogleCredentials } from './oauth.js';

const SUCCESS_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Overlook — Google Drive connected</title>
<body style="font-family: system-ui; display: grid; place-items: center; min-height: 80vh">
<p>Connected — you can close this tab and return to Overlook.</p>
<script>history.replaceState(null, '', '/')</script>
</body>`;

export interface GoogleDriveLoopbackCapture {
  readonly listening: Promise<{ port: number; redirectUri: string }>;
  readonly result: Promise<string>;
  close(): void;
}

/** Desktop installed-app callback. A random loopback port avoids fixed-port
 * collisions; only the matching state nonce can settle the pending flow. */
export function startGoogleDriveLoopbackCapture(options: {
  readonly state: string;
  readonly port?: number;
  readonly timeoutMs?: number;
}): GoogleDriveLoopbackCapture {
  const requestedPort = options.port ?? 0;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  let settled = false;
  let resolveResult: (code: string) => void;
  let rejectResult: (error: Error) => void;
  const result = new Promise<string>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  result.catch(() => undefined);

  function settle(outcome: { ok: true; code: string } | { ok: false; error: Error }): void {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    setImmediate(() => server.close());
    if (outcome.ok) resolveResult(outcome.code);
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
    if (url.searchParams.get('state') !== options.state) {
      response.writeHead(400).end('Invalid authorization state.');
      return;
    }
    const providerError = url.searchParams.get('error');
    if (providerError !== null) {
      response.writeHead(400).end('Google Drive connection failed. Return to Overlook and try again.');
      settle({ ok: false, error: new GoogleDriveOAuthError(`Google Drive authorization failed: ${providerError}`) });
      return;
    }
    const code = url.searchParams.get('code');
    if (code === null || code === '') {
      response.writeHead(400).end('Google Drive did not return an authorization code.');
      settle({ ok: false, error: new GoogleDriveOAuthError('Google Drive authorization did not return a code.') });
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(SUCCESS_PAGE);
    settle({ ok: true, code });
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
