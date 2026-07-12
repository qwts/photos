import { protocol } from 'electron';

import { parseThumbUrl, THUMB_SCHEME } from '../../shared/library/thumb-url.js';
import type { ThumbService } from './thumb-service.js';

// overlook-thumb:// (#75): decrypted thumbs straight into <img> tags —
// memory-only, no plaintext files. Content-addressed blobs make responses
// immutable, so the renderer's HTTP cache short-circuits repeat requests.

/** MUST run before app ready (Electron requirement for privileged schemes). */
export function registerThumbSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: THUMB_SCHEME,
      privileges: { standard: true, stream: true, supportFetchAPI: true },
    },
  ]);
}

/** Call once after app ready; the service is created lazily like the library. */
export function registerThumbProtocol(getService: () => ThumbService): void {
  protocol.handle(THUMB_SCHEME, async (request) => {
    const parsed = parseThumbUrl(request.url);
    if (parsed === null) {
      return new Response(null, { status: 400 });
    }
    const loaded = await getService().getThumb(parsed.photoId, parsed.size, request.signal);
    if (loaded === null) {
      // Missing thumb OR cancelled-while-queued: the renderer shows its
      // placeholder (real thumbs for legacy rows backfill in M05).
      return new Response(null, { status: 404 });
    }
    return new Response(new Uint8Array(loaded.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=31536000, immutable',
        ETag: `"${loaded.contentHash}.${parsed.size}"`,
      },
    });
  });
}
