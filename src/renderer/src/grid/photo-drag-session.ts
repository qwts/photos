import { decodePhotoDrag, encodePhotoDrag, PHOTO_DRAG_TYPE, type PhotoDragPayload } from '../../../shared/library/photo-drag.js';

let activePayload: PhotoDragPayload | null = null;

export function beginPhotoDrag(dataTransfer: DataTransfer, payload: PhotoDragPayload): void {
  activePayload = payload;
  dataTransfer.effectAllowed = payload.sourceAlbumId === null ? 'copy' : 'copyMove';
  dataTransfer.setData(PHOTO_DRAG_TYPE, encodePhotoDrag(payload));
}

export function readPhotoDrag(dataTransfer: DataTransfer): PhotoDragPayload | null {
  const encoded = dataTransfer.getData(PHOTO_DRAG_TYPE);
  return (encoded === '' ? null : decodePhotoDrag(encoded)) ?? activePayload;
}

export function hasPhotoDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(PHOTO_DRAG_TYPE) || activePayload !== null;
}

export function endPhotoDrag(): void {
  activePayload = null;
}
