// i18n locale model (#403, ADR-0020 §2) — pure and process-free so both the
// main resolver and the renderer runtime share one source of truth. Holds the
// supported set, the RTL set, the fallback chain, and locale negotiation.
// Catalog data lives alongside in ./messages; the react-intl runtime is
// renderer-only (src/renderer/src/i18n/).

/** The source catalog language: every message id originates here, and it is the
 * terminal fallback for negotiation. */
export const SOURCE_LOCALE = 'en';

/** Locales shipped to users. Launch is en-only (ADR §7) — adding a language is
 * a data change (a new messages/<locale>.json), not an engineering one. */
export const SHIPPED_LOCALES = ['en'] as const;

/** Generated pseudo-locales (ADR §6). Dev, Storybook, and CI only — never
 * shipped. `en-XA` accents/expands to reveal unextracted strings and truncation;
 * `en-XB` is the bidi/RTL pseudo that exercises `dir` propagation and mirroring
 * with no translator. Pinnable via OVERLOOK_LOCALE. */
export const PSEUDO_LOCALES = ['en-XA', 'en-XB'] as const;

/** Base languages that render right-to-left (ADR §5). Matched on the primary
 * subtag, so regional variants (`ar-EG`, `ur-PK`) are covered. */
const RTL_BASE_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

/** The bidi pseudo-locale is force-RTL even though its base subtag is `en`. */
const FORCED_RTL_TAGS = new Set<string>(['en-XB']);

/** Primary language subtag of a BCP-47 tag: `pt-BR` → `pt`. */
export function baseLanguage(tag: string): string {
  const [primary] = tag.split('-');
  return primary === undefined || primary === '' ? tag : primary.toLowerCase();
}

/** Progressive fallback for a tag, most to least specific, source excluded:
 * `pt-BR` → `['pt-BR', 'pt']`. Negotiation appends SOURCE_LOCALE as the floor. */
export function fallbackChain(tag: string): readonly string[] {
  const parts = tag.split('-');
  const chain: string[] = [];
  for (let end = parts.length; end > 0; end -= 1) {
    chain.push(parts.slice(0, end).join('-'));
  }
  return chain;
}

/** Text direction for a locale (ADR §5). Stamped on `<html dir>` alongside
 * `lang`; both are set together because CSS casing is language-sensitive. */
export function directionOf(locale: string): 'ltr' | 'rtl' {
  if (FORCED_RTL_TAGS.has(locale)) return 'rtl';
  return RTL_BASE_LANGUAGES.has(baseLanguage(locale)) ? 'rtl' : 'ltr';
}

/**
 * Resolve the active locale from an ordered list of preferences against the
 * catalogs actually available (ADR §2 resolution order: setting → OS locale →
 * `en`). Each preference walks its own fallback chain before the next is tried;
 * SOURCE_LOCALE is the terminal fallback. `null`/`undefined`/empty preferences
 * (e.g. "follow OS") are skipped.
 */
export function resolveLocale(preferences: readonly (string | null | undefined)[], available: readonly string[] = SHIPPED_LOCALES): string {
  const catalog = new Set(available);
  for (const preference of preferences) {
    if (preference === null || preference === undefined || preference === '') continue;
    for (const candidate of fallbackChain(preference)) {
      if (catalog.has(candidate)) return candidate;
    }
  }
  return SOURCE_LOCALE;
}

/** Locales an unpackaged build may pin via OVERLOOK_LOCALE — the shipped set
 * plus the dev-only pseudo-locales. Pinning is ignored in packaged builds so a
 * stray env var can never surface pseudo text to a user. */
const PINNABLE_LOCALES = new Set<string>([...SHIPPED_LOCALES, ...PSEUDO_LOCALES]);

/**
 * The active runtime locale from process inputs (ADR §2). An OVERLOOK_LOCALE pin
 * wins in unpackaged builds only (test determinism, dev pseudo-locales);
 * otherwise the OS locale negotiates against the shipped catalogs, falling back
 * to `en`. A pin is accepted when its fallback chain reaches a pinnable locale,
 * and the REQUESTED tag is returned — `en-US` pins the en-US region for `Intl`
 * while messages fall back to the `en` catalog — so harness assertions on
 * formatted output are machine-independent (PR #473 review). Pure so it is
 * unit-tested without Electron; main's resolver is a thin wrapper that reads
 * `app`.
 */
export function resolveRuntimeLocale(input: {
  pinned?: string | undefined;
  packaged: boolean;
  language?: string | null | undefined;
  osLocale: string;
}): string {
  if (!input.packaged && input.pinned !== undefined && fallbackChain(input.pinned).some((tag) => PINNABLE_LOCALES.has(tag))) {
    return input.pinned;
  }
  if (input.language !== null && input.language !== undefined) {
    const languageChain = fallbackChain(input.language);
    const isPackagedPseudo = input.packaged && languageChain.some((tag) => PSEUDO_LOCALES.includes(tag as (typeof PSEUDO_LOCALES)[number]));
    const selectableLocales = input.packaged ? new Set<string>(SHIPPED_LOCALES) : PINNABLE_LOCALES;
    if (!isPackagedPseudo && languageChain.some((tag) => selectableLocales.has(tag))) return input.language;
  }
  return resolveLocale([input.osLocale]);
}
