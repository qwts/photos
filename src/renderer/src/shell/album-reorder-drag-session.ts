import {
  ALBUM_REORDER_DRAG_TYPE,
  decodeAlbumReorderDrag,
  encodeAlbumReorderDrag,
  type AlbumReorderDragPayload,
} from '../../../shared/library/album-reorder-drag.js';
import type { PhotoDragDataTransfer } from '../grid/photo-drag-session.js';

let activePayload: AlbumReorderDragPayload | null = null;

export function beginAlbumReorderDrag(dataTransfer: PhotoDragDataTransfer, albumId: string): void {
  activePayload = { version: 1, albumId };
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(ALBUM_REORDER_DRAG_TYPE, encodeAlbumReorderDrag(activePayload));
}

export function hasAlbumReorderDrag(dataTransfer: PhotoDragDataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(ALBUM_REORDER_DRAG_TYPE) || activePayload !== null;
}

export function readAlbumReorderDrag(dataTransfer: PhotoDragDataTransfer): AlbumReorderDragPayload | null {
  const encoded = dataTransfer.getData(ALBUM_REORDER_DRAG_TYPE);
  return (encoded === '' ? null : decodeAlbumReorderDrag(encoded)) ?? activePayload;
}

export function endAlbumReorderDrag(): void {
  activePayload = null;
}
