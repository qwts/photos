import { createServer } from 'node:http';

import { PCLOUD_LOOPBACK_PORT, PCloudOAuthError, parseOAuthParams, redactTokens } from './oauth.js';
import type { PCloudOAuthResult } from './oauth.js';

// Loopback capture for the implicit flow (#254). The system browser lands on
// /callback, but the token rides the URL FRAGMENT — which never reaches an
// HTTP server. So /callback serves a tiny relay page whose script re-sends
// location.hash (or the query, where provider errors arrive) to /capture,
// where it is validated and handed to the app. One capture per listener;
// the server closes as soon as the flow settles.

const RELAY_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Overlook — connecting…</title>
<body style="font-family: system-ui; display: grid; place-items: center; min-height: 80vh">
<p id="m">Connecting to Overlook…</p>
<script>
  fetch('/capture?' + (location.hash.slice(1) || location.search.slice(1)))
    .then((r) => {
      document.getElementById('m').textContent = r.ok
        ? 'Connected — you can close this tab and return to Overlook.'
        : 'Connection failed — return to Overlook and try again.';
    })
    .catch(() => {
      document.getElementById('m').textContent = 'Connection failed — return to Overlook and try again.';
    });
</script>
</body>`;

export interface LoopbackCaptureOptions {
  readonly state: string;
  /** Overridable for tests (0 = ephemeral); production uses the registered
   * redirect port. */
  readonly port?: number;
  readonly timeoutMs?: number;
}

export interface LoopbackCapture {
  /** Resolves once the listener is bound (with the actual port). */
  readonly listening: Promise<number>;
  /** Resolves with the validated token; rejects on error/timeout/close. */
  readonly result: Promise<PCloudOAuthResult>;
  /** Abort (user cancelled, app quitting) — rejects `result` if pending. */
  close(): void;
}

export function startLoopbackCapture(options: LoopbackCaptureOptions): LoopbackCapture {
  const port = options.port ?? PCLOUD_LOOPBACK_PORT;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;

  let settled = false;
  let resolveResult: (value: PCloudOAuthResult) => void;
  let rejectResult: (reason: Error) => void;
  const result = new Promise<PCloudOAuthResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // The flow can settle (browser answers) before the caller reaches its
  // await — that gap must not surface as an unhandled rejection.
  result.catch(() => undefined);

  // Hoisted: referenced by the request handler and timer below, but only
  // ever invoked after `timer` and `server` are initialized.
  function settle(outcome: { ok: true; value: PCloudOAuthResult } | { ok: false; error: Error }): void {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    // Close AFTER the in-flight response flushes; closeAllConnections would
    // cut off the relay page's confirmation text.
    setImmediate(() => {
      server.close();
    });
    if (outcome.ok) {
      resolveResult(outcome.value);
    } else {
      rejectResult(outcome.error);
    }
  }

  const timer = setTimeout(() => {
    settle({ ok: false, error: new PCloudOAuthError('pCloud authorization timed out.') });
  }, timeoutMs);

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${String(port)}`);
    if (url.pathname === '/callback') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(RELAY_PAGE);
      return;
    }
    if (url.pathname === '/capture') {
      if (settled) {
        response.writeHead(409).end();
        return;
      }
      try {
        const value = parseOAuthParams(url.searchParams, options.state);
        response.writeHead(204).end();
        settle({ ok: true, value });
      } catch (error) {
        response.writeHead(400).end();
        const message = error instanceof Error ? redactTokens(error.message) : 'pCloud authorization failed.';
        settle({ ok: false, error: error instanceof PCloudOAuthError ? error : new PCloudOAuthError(message) });
      }
      return;
    }
    response.writeHead(404).end();
  });

  const listening = new Promise<number>((resolve, reject) => {
    server.once('error', (error: Error) => {
      const wrapped = new PCloudOAuthError(redactTokens(`pCloud sign-in listener failed: ${error.message}`));
      reject(wrapped);
      settle({ ok: false, error: wrapped });
    });
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : port);
    });
  });
  // The caller consumes rejection through `result`; an unobserved `listening`
  // rejection must not crash the process.
  listening.catch(() => undefined);

  return {
    listening,
    result,
    close: () => {
      settle({ ok: false, error: new PCloudOAuthError('pCloud authorization was cancelled.') });
    },
  };
}
