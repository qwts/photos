// RAF embedded-preview extraction (ADR-0006 RAW v1 policy): FUJIFILM's RAF
// container documents the offset and length of a full embedded JPEG in its
// fixed header. Detection is by magic, never by extension. Shared by EXIF
// extraction (#85), full-res delivery (#91) and thumbnail generation (#86).

const RAF_MAGIC = 'FUJIFILMCCD-RAW ';
const RAF_JPEG_OFFSET_AT = 84;
const RAF_JPEG_LENGTH_AT = 88;

/** The embedded JPEG of a RAF container, or null when `bytes` is not a RAF
 * (or its header does not describe a plausible embedded image). */
export function embeddedJpegFromRaf(bytes: Buffer): Buffer | null {
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

/** JPEG SOI sniff — magic, not extension (same stance as the RAF check). */
export function looksLikeJpeg(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}
