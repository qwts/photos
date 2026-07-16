import { protocol } from 'electron';

import { FULL_SCHEME, parseFullUrl } from '../../shared/library/full-url.js';
import type { FullService } from './full-service.js';

// overlook-full:// (#91): decrypted originals straight to the lightbox —
// memory-only. Every response carries `Cache-Control: no-store` so Chromium
// never writes plaintext full-res bytes into its disk cache; repeat views
// are served from the FullService LRU instead. Scheme privileges register in
// main/protocol-privileges.ts (one registerSchemesAsPrivileged call).

// Unlike the thumbs' <img> path, fetch() enforces CORS: the renderer's
// app origin is cross-origin to this scheme, so responses must opt in.
// The protocol only exists inside our session — '*' exposes nothing new.
const NO_STORE = {
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'X-Overlook-Preview',
};

/** Call once after app ready; the service is created lazily like the library. */
export function registerFullProtocol(getService: () => FullService, admit: () => void = () => undefined): void {
  protocol.handle(FULL_SCHEME, async (request) => {
    try {
      admit();
    } catch {
      return new Response(null, { status: 404, headers: NO_STORE });
    }
    const parsed = parseFullUrl(request.url);
    if (parsed === null) {
      return new Response(null, { status: 400, headers: NO_STORE });
    }
    const service = getService();
    if (parsed.prefetch) {
      // Neighbor warm: start the decrypt, answer immediately, ship no body.
      service.prefetch([parsed.photoId]);
      return new Response(null, { status: 204, headers: NO_STORE });
    }
    const payload = await service.getFull(parsed.photoId, request.signal);
    if (payload === null) {
      // Missing/offloaded original or un-renderable RAW: placeholder (E7.2).
      return new Response(null, { status: 404, headers: NO_STORE });
    }
    return new Response(new Uint8Array(payload.bytes), {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': payload.mime,
        ...(payload.preview ? { 'X-Overlook-Preview': '1' } : {}),
      },
    });
  });
}
