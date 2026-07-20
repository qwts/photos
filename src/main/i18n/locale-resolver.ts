import { app } from 'electron';

import { resolveRuntimeLocale } from '../../shared/i18n/locales.js';

// Main-process locale resolution (#403, ADR-0020 §2). Thin Electron wrapper over
// the pure `resolveRuntimeLocale` (unit-tested in shared): reads OVERLOOK_LOCALE,
// packaging state, and the OS locale, and hands them off. The renderer fetches
// the result over `app:get-locale` and re-fetches on settings change so #405's
// language setting switches live (pass it ahead of the OS locale then).

export function resolveActiveLocale(language: string | null): string {
  return resolveRuntimeLocale({
    pinned: process.env['OVERLOOK_LOCALE'],
    packaged: app.isPackaged,
    language,
    osLocale: app.getLocale(),
  });
}
