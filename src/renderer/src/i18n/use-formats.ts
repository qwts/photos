import { useMemo } from 'react';
import { useIntl } from 'react-intl';

import {
  formatBytes as formatBytesForLocale,
  formatCalendarDate as formatCalendarDateForLocale,
  formatCount as formatCountForLocale,
  formatRelativeTime as formatRelativeTimeForLocale,
} from '../../../shared/i18n/formats.js';

export interface AppFormatters {
  readonly formatBytes: (bytes: number) => string;
  readonly formatCalendarDate: (iso: string) => string;
  readonly formatCount: (value: number) => string;
  readonly formatRelativeTime: (iso: string, now: number) => string;
}

/** Bind the pure shared formatters to the locale resolved by main and supplied
 * by IntlHost. Callers never fall back to the host processes locale. */
export function useFormats(): AppFormatters {
  const { locale } = useIntl();
  return useMemo(
    () => ({
      formatBytes: (bytes) => formatBytesForLocale(locale, bytes),
      formatCalendarDate: (iso) => formatCalendarDateForLocale(locale, iso),
      formatCount: (value) => formatCountForLocale(locale, value),
      formatRelativeTime: (iso, now) => formatRelativeTimeForLocale(locale, iso, now),
    }),
    [locale],
  );
}
