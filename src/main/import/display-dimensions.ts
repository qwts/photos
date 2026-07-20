export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

function positiveSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Returns the dimensions users see after applying the EXIF orientation. */
export function displayDimensions(width: unknown, height: unknown, orientation?: unknown): ImageDimensions | null {
  const safeWidth = positiveSafeInteger(width);
  const safeHeight = positiveSafeInteger(height);
  if (safeWidth === null || safeHeight === null) return null;
  return typeof orientation === 'number' && orientation >= 5 && orientation <= 8
    ? { width: safeHeight, height: safeWidth }
    : { width: safeWidth, height: safeHeight };
}
