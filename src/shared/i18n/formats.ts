// Formatting seam (#403 stub, consumed by #404 — ADR-0020 §4). In v1 one active
// locale drives both messages and `Intl`, so the region-format locale is the UI
// locale (identity). This module is the single place that assumption is encoded:
// when the UI-language-vs-region-format split lands, only `formatLocaleFor`
// changes. Follows CLDR defaults for numbering system and calendar — no
// overrides. Pure and process-free (src/shared/ constraint).

/**
 * The locale that drives `Intl` formatters for a given UI locale. Identity in
 * v1; the seam for a future "English UI, German number/date format" preference.
 * Pseudo-locales format under their base language so counts/dates stay sane in
 * dev.
 */
export function formatLocaleFor(uiLocale: string): string {
  if (uiLocale === 'en-XA' || uiLocale === 'en-XB') return 'en';
  return uiLocale;
}

/**
 * Named `Intl` format presets shared across formatters and react-intl's
 * `formats` prop, so a date rendered in a message and one rendered by
 * `formatDate` agree. Extended by #404 as the format call sites migrate.
 */
export const namedFormats = {
  date: {
    short: { year: 'numeric', month: 'short', day: 'numeric' },
  },
} as const satisfies {
  readonly date: Readonly<Record<string, Intl.DateTimeFormatOptions>>;
};
