import { protocol } from 'electron';

import { FULL_SCHEME } from '../shared/library/full-url.js';
import { THUMB_SCHEME } from '../shared/library/thumb-url.js';

// Electron allows exactly one registerSchemesAsPrivileged call (it replaces
// the whole list), and it MUST run before app ready — so every Overlook
// scheme registers here, together.
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: THUMB_SCHEME,
      privileges: { standard: true, stream: true, supportFetchAPI: true },
    },
    {
      // corsEnabled puts the scheme on Chromium's CORS-allowed list —
      // without it, renderer fetch() (lightbox loads + neighbor prefetch)
      // is rejected outright; the handler still answers with explicit
      // Access-Control headers.
      scheme: FULL_SCHEME,
      privileges: { standard: true, stream: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}
