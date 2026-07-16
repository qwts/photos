import { decodePhotoDrag, encodePhotoDrag, PHOTO_DRAG_TYPE, type PhotoDragPayload } from '../../../shared/library/photo-drag.js';

let activePayload: PhotoDragPayload | null = null;

export interface PhotoDragDataTransfer {
  effectAllowed: 'none' | 'copy' | 'copyLink' | 'copyMove' | 'link' | 'linkMove' | 'move' | 'all' | 'uninitialized';
  readonly types: readonly string[];
  readonly getData: (type: string) => string;
  readonly setData: (type: string, value: string) => void;
}

export function beginPhotoDrag(dataTransfer: PhotoDragDataTransfer, payload: PhotoDragPayload): void {
  const normalized = decodePhotoDrag(encodePhotoDrag(payload));
  if (normalized === null) {
    activePayload = null;
    dataTransfer.effectAllowed = 'none';
    return;
  }
  activePayload = normalized;
  dataTransfer.effectAllowed = normalized.sourceAlbumId === null ? 'copy' : 'copyMove';
  dataTransfer.setData(PHOTO_DRAG_TYPE, encodePhotoDrag(normalized));
}

export function readPhotoDrag(dataTransfer: PhotoDragDataTransfer): PhotoDragPayload | null {
  const encoded = dataTransfer.getData(PHOTO_DRAG_TYPE);
  return (encoded === '' ? null : decodePhotoDrag(encoded)) ?? activePayload;
}

export function hasPhotoDrag(dataTransfer: PhotoDragDataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(PHOTO_DRAG_TYPE) || activePayload !== null;
}

export function endPhotoDrag(): void {
  activePayload = null;
}
