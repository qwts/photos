import { FULL_SCHEME } from '../shared/library/full-url.js';
import { THUMB_SCHEME } from '../shared/library/thumb-url.js';

export const schemePrivilegeContract = [
  {
    scheme: THUMB_SCHEME,
    privileges: { standard: true, stream: true },
  },
  {
    // Full-image lightbox loads and neighbor prefetch use renderer fetch().
    // Chromium requires both fetch and CORS privileges for that path.
    scheme: FULL_SCHEME,
    privileges: { standard: true, stream: true, supportFetchAPI: true, corsEnabled: true },
  },
] as const;
