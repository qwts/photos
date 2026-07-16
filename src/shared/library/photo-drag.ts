export const PHOTO_DRAG_TYPE = 'application/x-overlook-photo-selection+json';

export interface PhotoDragPayload {
  readonly version: 1;
  readonly photoIds: readonly string[];
  readonly sourceAlbumId: string | null;
}

const MAX_DRAG_PHOTOS = 10_000;

export function encodePhotoDrag(payload: PhotoDragPayload): string {
  return JSON.stringify(payload);
}

export function decodePhotoDrag(value: string): PhotoDragPayload | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const photoIds = record['photoIds'];
    const sourceAlbumId = record['sourceAlbumId'];
    if (
      record['version'] !== 1 ||
      !Array.isArray(photoIds) ||
      photoIds.length === 0 ||
      photoIds.length > MAX_DRAG_PHOTOS ||
      !photoIds.every((id) => typeof id === 'string' && id !== '') ||
      (sourceAlbumId !== null && (typeof sourceAlbumId !== 'string' || sourceAlbumId === ''))
    ) {
      return null;
    }
    return { version: 1, photoIds: [...new Set(photoIds as string[])], sourceAlbumId };
  } catch {
    return null;
  }
}
