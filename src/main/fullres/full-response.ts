import { parseFullUrl, parseProtectedFullUrl } from '../../shared/library/full-url.js';
import type { ProtectedMediaService } from '../library/protected-media-service.js';
import type { FullService } from './full-service.js';

const NO_STORE = {
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'X-Overlook-Preview',
};

export async function handleFullRequest(
  getService: () => FullService,
  admit: () => void,
  request: Request,
  getProtected?: (() => ProtectedMediaService) | undefined,
): Promise<Response> {
  try {
    admit();
  } catch {
    return new Response(null, { status: 404, headers: NO_STORE });
  }
  const parsed = parseFullUrl(request.url);
  const protectedTarget = parsed === null ? parseProtectedFullUrl(request.url) : null;
  if (parsed === null && protectedTarget === null) return new Response(null, { status: 400, headers: NO_STORE });
  if (parsed?.prefetch === true) {
    getService().prefetch([parsed.photoId]);
    return new Response(null, { status: 204, headers: NO_STORE });
  }
  if (protectedTarget?.prefetch === true) {
    const protectedService = getProtected?.();
    if (protectedService === undefined || !protectedService.isAuthorized(protectedTarget.albumId, protectedTarget.photoId)) {
      return new Response(null, { status: 404, headers: NO_STORE });
    }
    protectedService.prefetch(protectedTarget.albumId, [protectedTarget.photoId]);
    return new Response(null, { status: 204, headers: NO_STORE });
  }
  const payload =
    parsed !== null
      ? await getService().getFull(parsed.photoId, request.signal)
      : getProtected === undefined
        ? null
        : await getProtected().getFull(protectedTarget!.albumId, protectedTarget!.photoId, request.signal);
  if (payload === null) return new Response(null, { status: 404, headers: NO_STORE });
  return new Response(new Uint8Array(payload.bytes), {
    status: 200,
    headers: {
      ...NO_STORE,
      'Content-Type': payload.mime,
      ...(payload.preview ? { 'X-Overlook-Preview': '1' } : {}),
    },
  });
}
