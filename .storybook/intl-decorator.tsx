import { useEffect, type ReactElement } from 'react';
import { IntlProvider } from 'react-intl';
import type { Decorator, Preview } from '@storybook/react-vite';

import { SOURCE_LOCALE, directionOf } from '../src/shared/i18n/locales';
import { namedFormats } from '../src/shared/i18n/formats';
import { loadCatalog } from '../src/renderer/src/i18n/catalog';

// Global i18n decorator (#403, ADR-0020 §1/§6). Every story renders inside an
// IntlProvider — required now that surfaces use react-intl — and the toolbar
// switches locale, making the `en-XA` (accented/expanded) and `en-XB` (bidi/RTL)
// pseudo-locales available in Storybook to catch unextracted strings, truncation,
// and mirroring without a translator.

export const localeGlobalType: NonNullable<Preview['globalTypes']> = {
  locale: {
    description: 'i18n locale',
    defaultValue: SOURCE_LOCALE,
    toolbar: {
      icon: 'globe',
      dynamicTitle: true,
      items: [
        { value: 'en', title: 'English' },
        { value: 'en-XA', title: 'Pseudo — accented' },
        { value: 'en-XB', title: 'Pseudo — bidi/RTL' },
      ],
    },
  },
};

function IntlStory({ locale, children }: { readonly locale: string; readonly children: ReactElement }): ReactElement {
  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = directionOf(locale);
    return () => {
      root.lang = SOURCE_LOCALE;
      root.dir = 'ltr';
    };
  }, [locale]);
  return (
    <IntlProvider
      locale={locale}
      defaultLocale={SOURCE_LOCALE}
      messages={loadCatalog(locale)}
      formats={namedFormats}
      defaultFormats={namedFormats}
    >
      {children}
    </IntlProvider>
  );
}

export const withIntl: Decorator = (Story, context) => {
  const locale = typeof context.globals['locale'] === 'string' ? context.globals['locale'] : SOURCE_LOCALE;
  return (
    <IntlStory locale={locale}>
      <Story />
    </IntlStory>
  );
};
