import { SOURCE_LOCALE, fallbackChain } from '../../../shared/i18n/locales.js';
import { catalogs } from '../../../shared/i18n/generated/index.js';
import { isPseudoLocale, toPseudoCatalog } from './pseudo.js';

// Catalog loader for the react-intl runtime (#403, ADR-0020 §1/§6). Resolves a
// locale to its message map: a runtime-derived pseudo-locale, the closest
// compiled catalog along the BCP-47 fallback chain (`pt-BR` → `pt` → source), or
// the `en` source as the terminal fallback — so an unknown tag renders source
// copy rather than missing ids. The generated registry has one entry per
// committed messages/<locale>.json, keeping "add a language" a data change.

export type MessageCatalog = Readonly<Record<string, string>>;

const sourceCatalog = (): MessageCatalog => catalogs[SOURCE_LOCALE] ?? {};

export function loadCatalog(locale: string): MessageCatalog {
  if (isPseudoLocale(locale)) return toPseudoCatalog(sourceCatalog(), locale);
  for (const candidate of fallbackChain(locale)) {
    const catalog = catalogs[candidate];
    if (catalog !== undefined) return catalog;
  }
  return sourceCatalog();
}
