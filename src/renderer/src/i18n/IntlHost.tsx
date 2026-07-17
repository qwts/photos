import { useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { IntlProvider, ReactIntlErrorCode } from 'react-intl';
import type { IntlConfig } from 'react-intl';

type OnIntlError = NonNullable<IntlConfig['onError']>;

import { SOURCE_LOCALE, directionOf } from '../../../shared/i18n/locales.js';
import { namedFormats } from '../../../shared/i18n/formats.js';
import { loadCatalog } from './catalog.js';

// App-runtime i18n provider (#403, ADR-0020 §1/§2). Sits above the lock-state
// branch so every surface — LockScreen included — is localized. The active
// locale is resolved authoritatively in main; this fetches it, stamps `lang`
// and `dir` on <html> together (CSS casing is language-sensitive), and
// re-fetches on settings change so #405's language setting switches live.

/** Missing catalog entries are expected under the source locale (defaultMessage
 * is the copy) — swallow them so the console shows only real ICU errors. */
const onIntlError: OnIntlError = (error) => {
  if (error.code === ReactIntlErrorCode.MISSING_TRANSLATION) return;
  console.error(error);
};

function applyDocumentLocale(locale: string): void {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = directionOf(locale);
}

export function IntlHost({ children }: { readonly children: ReactNode }): ReactElement | null {
  const [locale, setLocale] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = (): void => {
      void window.overlook.getLocale().then((next) => {
        if (active) setLocale(next);
      });
    };
    refresh();
    // The future language setting rides the settings change event (#405); a
    // resolved-locale change re-stamps and re-renders without a restart.
    const unsubscribe = window.overlook.settings.onChanged(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (locale !== null) applyDocumentLocale(locale);
  }, [locale]);

  // Hold the first frame until main answers, so tests and stories never observe
  // a source-locale flash before OVERLOOK_LOCALE/OS resolution lands.
  if (locale === null) return null;

  return (
    <IntlProvider
      locale={locale}
      defaultLocale={SOURCE_LOCALE}
      messages={loadCatalog(locale)}
      formats={namedFormats}
      defaultFormats={namedFormats}
      onError={onIntlError}
    >
      {children}
    </IntlProvider>
  );
}
