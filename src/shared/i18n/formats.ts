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
