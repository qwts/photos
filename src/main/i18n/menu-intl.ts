import { createIntl, createIntlCache } from '@formatjs/intl';

import { catalogs } from './generated/index.js';
import { fallbackChain, SOURCE_LOCALE } from '../../shared/i18n/locales.js';
import type { MessageDescriptor } from '../application-menu-model.js';

const cache = createIntlCache();

function catalogFor(locale: string): Readonly<Record<string, string>> {
  for (const candidate of fallbackChain(locale)) {
    const catalog = catalogs[candidate];
    if (catalog !== undefined) return catalog;
  }
  return catalogs[SOURCE_LOCALE] ?? {};
}

/** Main consumes the same compiled ICU catalogs as the renderer (ADR-0020). */
export function createMenuTranslator(locale: string): (message: MessageDescriptor) => string {
  const intl = createIntl({ locale, defaultLocale: SOURCE_LOCALE, messages: catalogFor(locale) }, cache);
  return (message) => intl.formatMessage(message);
}
