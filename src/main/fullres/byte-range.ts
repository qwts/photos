// HTTP Range parsing for the video delivery path (ADR-0026 §5). Pure and
// bounded: a single `bytes=start-end` range only (no multipart), which is all
// the Chromium media stack and the MPEG-TS remux loader ever request. An
// unsatisfiable or malformed range is reported so the handler can answer 416 /
// fall back to a 200, never crash.

export type ByteRange =
  | { readonly kind: 'full' }
  | { readonly kind: 'partial'; readonly start: number; readonly end: number }
  | { readonly kind: 'unsatisfiable' };

/**
 * Resolves a `Range` header against a known total size. Returns `full` when the
 * header is absent (a normal 200), `partial` with an inclusive [start, end]
 * clamped to the file, or `unsatisfiable` when the range lies outside it.
 */
export function resolveByteRange(header: string | null, totalBytes: number): ByteRange {
  if (header === null || header.trim() === '') return { kind: 'full' };
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (match === null || totalBytes <= 0) return { kind: 'unsatisfiable' };
  const rawStart = match[1] ?? '';
  const rawEnd = match[2] ?? '';
  if (rawStart === '' && rawEnd === '') return { kind: 'unsatisfiable' };

  let start: number;
  let end: number;
  if (rawStart === '') {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd);
    if (suffix <= 0) return { kind: 'unsatisfiable' };
    start = Math.max(0, totalBytes - suffix);
    end = totalBytes - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? totalBytes - 1 : Math.min(Number(rawEnd), totalBytes - 1);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= totalBytes) {
    return { kind: 'unsatisfiable' };
  }
  return { kind: 'partial', start, end };
}
