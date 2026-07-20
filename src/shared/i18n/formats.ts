// Formatting seam (#403 — ADR-0020 §4). In v1 one active locale drives both
// messages and `Intl`, so the region-format locale is the UI locale. This
// module is where that assumption is centralised: #404 extends it with the
// `Intl`-based formatters and, behind this same seam, a future UI-language-vs-
// region-format split. Follows CLDR defaults for numbering system and calendar
// — no overrides. Pure and process-free (src/shared/ constraint).

/**
 * Named `Intl` format presets shared between react-intl's `formats` prop and the
 * standalone formatters (#404), so a date rendered inside a message and one
 * rendered by `formatDate` agree. Grown as format call sites migrate.
 */
export const namedFormats = {
  date: {
    short: { year: 'numeric', month: 'short', day: 'numeric' },
  },
} as const satisfies {
  readonly date: Readonly<Record<string, Intl.DateTimeFormatOptions>>;
};

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte', 'petabyte'] as const;

export function formatCount(locale: string, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatBytes(locale: string, bytes: number): string {
  let value = bytes;
  let unitIndex = 0;
  while (Math.abs(value) >= 1000 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: BYTE_UNITS[unitIndex] ?? 'byte',
    unitDisplay: 'short',
    maximumFractionDigits: value >= 100 || Number.isInteger(value) ? 0 : 1,
  }).format(value);
}

export function formatRelativeTime(locale: string, iso: string, now: number): string {
  const elapsedMs = now - Date.parse(iso);
  const formatter = new Intl.RelativeTimeFormat(locale, { style: 'narrow', numeric: 'auto' });
  if (Number.isNaN(elapsedMs) || elapsedMs < 0) return formatter.format(0, 'second');
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return formatter.format(0, 'second');
  if (minutes < 60) return formatter.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, 'hour');
  return formatter.format(-Math.floor(hours / 24), 'day');
}

/** Format the recorded calendar date without allowing the host time zone to
 * shift its day. Stored timestamps remain the sort/grouping source of truth. */
export function formatCalendarDate(locale: string, iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (match === null) return '—';
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.valueOf())) return '—';
  return new Intl.DateTimeFormat(locale, { ...namedFormats.date.short, timeZone: 'UTC' }).format(date);
}
