import type { FileKind } from './types.js';

// Media-file allowlist (#84) per ADR-0006: only these extensions are import
// candidates; everything else on a card (sidecars, videos, DCIM cruft) is
// ignored by the scanner. RAW list mirrors the ADR's embedded-preview
// vocabulary.

const KIND_BY_EXTENSION: Readonly<Record<string, FileKind>> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  heic: 'heic',
  heif: 'heic',
  raf: 'raw',
  cr2: 'raw',
  cr3: 'raw',
  nef: 'raw',
  arw: 'raw',
  dng: 'raw',
  orf: 'raw',
  rw2: 'raw',
};

/** FileKind for an import candidate, or null when not a media file. */
export function classifyMediaFile(fileName: string): FileKind | null {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) {
    return null;
  }
  // AppleDouble/hidden sidecars (._IMG_0001.JPG, .DS_Store) are never media.
  if (fileName.startsWith('.')) {
    return null;
  }
  return KIND_BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()] ?? null;
}
