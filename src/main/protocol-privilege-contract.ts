import { FULL_SCHEME } from '../shared/library/full-url.js';
import { THUMB_SCHEME } from '../shared/library/thumb-url.js';

export const schemePrivilegeContract = [
  {
    scheme: THUMB_SCHEME,
    privileges: { standard: true, stream: true, supportFetchAPI: true },
  },
  {
    scheme: FULL_SCHEME,
    privileges: { standard: true, stream: true, supportFetchAPI: true, corsEnabled: true },
  },
] as const;
