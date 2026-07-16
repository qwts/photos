import { parseProtectedThumbUrl, parseThumbUrl } from '../../shared/library/thumb-url.js';
import type { ProtectedMediaService } from '../library/protected-media-service.js';
import type { ThumbService } from './thumb-service.js';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function handleThumbRequest(
  getService: () => ThumbService,
  admit: () => void,
  request: Request,
  getProtected?: () => ProtectedMediaService,
): Promise<Response> {
  try {
    admit();
  } catch {
    return new Response(null, { status: 404, headers: NO_STORE });
  }
  const parsed = parseThumbUrl(request.url);
  const protectedTarget = parsed === null ? parseProtectedThumbUrl(request.url) : null;
  if (parsed === null && protectedTarget === null) return new Response(null, { status: 400, headers: NO_STORE });
  const loaded =
    parsed !== null
      ? await getService().getThumb(parsed.photoId, parsed.size, request.signal)
      : protectedTarget === null || getProtected === undefined
        ? null
        : await getProtected().getThumb(protectedTarget.albumId, protectedTarget.photoId, protectedTarget.size, request.signal);
  if (loaded === null) return new Response(null, { status: 404, headers: NO_STORE });
  return new Response(new Uint8Array(loaded.bytes), {
    status: 200,
    headers: { ...NO_STORE, 'Content-Type': 'image/jpeg' },
  });
}
