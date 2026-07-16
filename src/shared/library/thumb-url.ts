// Thumb protocol URL contract (#75) — shared so the renderer builds and the
// main-process handler parses the same shape. The photo id travels in the
// PATH, never the host: URL hosts are lowercased by the parser and ids are
// case-sensitive ULIDs.

export const THUMB_SCHEME = 'overlook-thumb';

export type ThumbUrlSize = 'thumb' | 'mid';

export function thumbUrl(photoId: string, size: ThumbUrlSize = 'thumb'): string {
  return `${THUMB_SCHEME}://library/${encodeURIComponent(photoId)}?size=${size}`;
}

export function protectedThumbUrl(albumId: string, photoId: string, size: ThumbUrlSize = 'thumb'): string {
  return `${THUMB_SCHEME}://protected/${encodeURIComponent(albumId)}/${encodeURIComponent(photoId)}?size=${size}`;
}

export interface ParsedThumbUrl {
  readonly photoId: string;
  readonly size: ThumbUrlSize;
}

export interface ParsedProtectedThumbUrl extends ParsedThumbUrl {
  readonly albumId: string;
}

function decoded(segment: string): string | null {
  try {
    const value = decodeURIComponent(segment);
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

/** Returns null for anything that is not a well-formed thumb URL. */
export function parseThumbUrl(rawUrl: string): ParsedThumbUrl | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${THUMB_SCHEME}:` || url.host !== 'library') {
    return null;
  }
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  if (segments.length !== 1 || segments[0] === undefined) {
    return null;
  }
  const photoId = decoded(segments[0]);
  const size = url.searchParams.get('size') ?? 'thumb';
  if (photoId === null || (size !== 'thumb' && size !== 'mid')) {
    return null;
  }
  return { photoId, size };
}

export function parseProtectedThumbUrl(rawUrl: string): ParsedProtectedThumbUrl | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${THUMB_SCHEME}:` || url.host !== 'protected') return null;
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  if (segments.length !== 2 || segments[0] === undefined || segments[1] === undefined) return null;
  const albumId = decoded(segments[0]);
  const photoId = decoded(segments[1]);
  const size = url.searchParams.get('size') ?? 'thumb';
  if (albumId === null || photoId === null || (size !== 'thumb' && size !== 'mid')) return null;
  return { albumId, photoId, size };
}
