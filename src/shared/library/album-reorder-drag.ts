export const ALBUM_REORDER_DRAG_TYPE = 'application/x-overlook-album-reorder';

export interface AlbumReorderDragPayload {
  readonly version: 1;
  readonly albumId: string;
}

export function encodeAlbumReorderDrag(payload: AlbumReorderDragPayload): string {
  return JSON.stringify(payload);
}

export function decodeAlbumReorderDrag(value: string): AlbumReorderDragPayload | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    return record['version'] === 1 && typeof record['albumId'] === 'string' && record['albumId'] !== ''
      ? { version: 1, albumId: record['albumId'] }
      : null;
  } catch {
    return null;
  }
}
