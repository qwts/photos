import exifr from 'exifr';

// EXIF extraction (#85) per ADR-0006's field set, robust to weird files:
// missing or corrupt metadata degrades to an all-null record — the import
// engine (#87) composes file-level facts around it. NEVER fabricate a value
// (interop rule): anything the file doesn't state is null.

export interface ExtractedMetadata {
  readonly width: number | null;
  readonly height: number | null;
  readonly camera: string | null;
  readonly lens: string | null;
  readonly iso: number | null;
  /** Formatted like the mock's aperture strings: "1.4". */
  readonly aperture: string | null;
  /** Formatted like the mock's shutter strings: "1/250". */
  readonly shutter: string | null;
  readonly focalLength: number | null;
  /** ISO 8601, from DateTimeOriginal. */
  readonly takenAt: string | null;
  readonly gpsLat: number | null;
  readonly gpsLon: number | null;
}

const EMPTY: ExtractedMetadata = {
  width: null,
  height: null,
  camera: null,
  lens: null,
  iso: null,
  aperture: null,
  shutter: null,
  focalLength: null,
  takenAt: null,
  gpsLat: null,
  gpsLon: null,
};

// RAF layout (documented FUJIFILM container): ASCII magic, then the offset
// and length of the embedded JPEG as u32 big-endian at bytes 84 and 88.
const RAF_MAGIC = 'FUJIFILMCCD-RAW ';
const RAF_JPEG_OFFSET_AT = 84;
const RAF_JPEG_LENGTH_AT = 88;

function embeddedJpegFromRaf(bytes: Buffer): Buffer | null {
  if (bytes.length < RAF_JPEG_LENGTH_AT + 4 || bytes.toString('ascii', 0, RAF_MAGIC.length) !== RAF_MAGIC) {
    return null;
  }
  const offset = bytes.readUInt32BE(RAF_JPEG_OFFSET_AT);
  const length = bytes.readUInt32BE(RAF_JPEG_LENGTH_AT);
  if (offset <= 0 || length <= 0 || offset + length > bytes.length) {
    return null;
  }
  return bytes.subarray(offset, offset + length);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function formatAperture(fNumber: number | null): string | null {
  if (fNumber === null || fNumber <= 0) {
    return null;
  }
  return String(Math.round(fNumber * 10) / 10);
}

function formatShutter(exposureSeconds: number | null): string | null {
  if (exposureSeconds === null || exposureSeconds <= 0) {
    return null;
  }
  if (exposureSeconds < 1) {
    return `1/${String(Math.round(1 / exposureSeconds))}`;
  }
  return `${String(Math.round(exposureSeconds * 10) / 10)}s`;
}

function asIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return null;
}

/**
 * Extracts the ADR-0006 field set from a media file's bytes. RAF containers
 * are detected by magic (not extension) and resolve to their embedded JPEG
 * first. Any parse failure returns the all-null record.
 */
export async function extractMetadata(bytes: Buffer): Promise<ExtractedMetadata> {
  const target = embeddedJpegFromRaf(bytes) ?? bytes;
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = (await exifr.parse(target, { tiff: true, exif: true, gps: true })) as Record<string, unknown> | undefined;
  } catch {
    return EMPTY;
  }
  if (parsed === undefined || parsed === null) {
    return EMPTY;
  }
  const make = asText(parsed['Make']);
  const model = asText(parsed['Model']);
  return {
    width: asFiniteNumber(parsed['ExifImageWidth']) ?? asFiniteNumber(parsed['ImageWidth']),
    height: asFiniteNumber(parsed['ExifImageHeight']) ?? asFiniteNumber(parsed['ImageHeight']),
    // The mock's camera strings read "FUJIFILM X-T5" — make + model, deduped
    // when the model already leads with the make.
    camera: model === null ? make : make === null || model.toUpperCase().startsWith(make.toUpperCase()) ? model : `${make} ${model}`,
    lens: asText(parsed['LensModel']),
    iso: asFiniteNumber(parsed['ISO']),
    aperture: formatAperture(asFiniteNumber(parsed['FNumber'])),
    shutter: formatShutter(asFiniteNumber(parsed['ExposureTime'])),
    focalLength: asFiniteNumber(parsed['FocalLength']),
    takenAt: asIsoDate(parsed['DateTimeOriginal']) ?? asIsoDate(parsed['CreateDate']),
    gpsLat: asFiniteNumber(parsed['latitude']),
    gpsLon: asFiniteNumber(parsed['longitude']),
  };
}
