// Full-resolution protocol URL contract (#91) — mirrors thumb-url.ts: the
// renderer builds and the main-process handler parses the same shape. The
// photo id travels in the PATH (URL hosts are lowercased; ids are
// case-sensitive ULIDs). `prefetch=1` asks main to warm its decrypt cache
// and reply 204 immediately — neighbor prefetch without shipping megabytes
// of body the renderer is not going to look at yet.

export const FULL_SCHEME = 'overlook-full';

export function fullUrl(photoId: string, options?: { readonly prefetch?: boolean }): string {
  const suffix = options?.prefetch === true ? '?prefetch=1' : '';
  return `${FULL_SCHEME}://library/${encodeURIComponent(photoId)}${suffix}`;
}

export interface ParsedFullUrl {
  readonly photoId: string;
  readonly prefetch: boolean;
}

/** Returns null for anything that is not a well-formed full-res URL. */
export function parseFullUrl(rawUrl: string): ParsedFullUrl | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${FULL_SCHEME}:` || url.host !== 'library') {
    return null;
  }
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  if (segments.length !== 1 || segments[0] === undefined) {
    return null;
  }
  const photoId = decodeURIComponent(segments[0]);
  if (photoId === '') {
    return null;
  }
  return { photoId, prefetch: url.searchParams.get('prefetch') === '1' };
}
