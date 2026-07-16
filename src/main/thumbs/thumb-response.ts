import { parseThumbUrl } from '../../shared/library/thumb-url.js';
import type { ThumbService } from './thumb-service.js';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function handleThumbRequest(getService: () => ThumbService, admit: () => void, request: Request): Promise<Response> {
  try {
    admit();
  } catch {
    return new Response(null, { status: 404, headers: NO_STORE });
  }
  const parsed = parseThumbUrl(request.url);
  if (parsed === null) return new Response(null, { status: 400, headers: NO_STORE });
  const loaded = await getService().getThumb(parsed.photoId, parsed.size, request.signal);
  if (loaded === null) return new Response(null, { status: 404, headers: NO_STORE });
  return new Response(new Uint8Array(loaded.bytes), {
    status: 200,
    headers: { ...NO_STORE, 'Content-Type': 'image/jpeg' },
  });
}
