import { SOURCE_LOCALE } from '../../../shared/i18n/locales.js';
import { en } from './generated/en.js';
import { isPseudoLocale, toPseudoCatalog } from './pseudo.js';

// Catalog loader for the react-intl runtime (#403, ADR-0020 §1/§6). Resolves a
// locale to its message map: the compiled `en` source, a runtime-derived
// pseudo-locale, or `en` as the terminal fallback (launch ships en-only, so
// unknown tags render source copy rather than missing ids).

export type MessageCatalog = Readonly<Record<string, string>>;

export function loadCatalog(locale: string): MessageCatalog {
  if (isPseudoLocale(locale)) return toPseudoCatalog(en, locale);
  if (locale === SOURCE_LOCALE) return en;
  return en;
}
