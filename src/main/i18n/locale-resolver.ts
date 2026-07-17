import { app } from 'electron';

import { PSEUDO_LOCALES, SHIPPED_LOCALES, resolveLocale } from '../../shared/i18n/locales.js';

// Main-process locale resolution (#403, ADR-0020 §2). The single authority for
// the active UI locale; the renderer fetches it over `app:get-locale` and
// re-fetches on settings change so #405's language setting switches live.

// Locales an unpackaged build may pin via OVERLOOK_LOCALE — the shipped set
// plus the dev-only pseudo-locales. Pinning is ignored in packaged builds so a
// stray env var can never surface pseudo text to a user.
const PINNABLE_LOCALES = new Set<string>([...SHIPPED_LOCALES, ...PSEUDO_LOCALES]);

/**
 * The active UI locale. Order: OVERLOOK_LOCALE (unpackaged test pin) → OS locale
 * via `app.getLocale()` → `en`. The `language` setting slots in ahead of the OS
 * locale in #405 (pass it as the first preference).
 */
export function resolveActiveLocale(): string {
  if (!app.isPackaged) {
    const pinned = process.env['OVERLOOK_LOCALE'];
    if (pinned !== undefined && PINNABLE_LOCALES.has(pinned)) return pinned;
  }
  return resolveLocale([app.getLocale()]);
}
