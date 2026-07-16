import { protocol } from 'electron';

import { THUMB_SCHEME } from '../../shared/library/thumb-url.js';
import type { ThumbService } from './thumb-service.js';
import type { ProtectedMediaService } from '../library/protected-media-service.js';
import { handleThumbRequest } from './thumb-response.js';

// overlook-thumb:// (#75): decrypted thumbs straight into <img> tags —
// memory-only, no plaintext files. Every response is no-store so Chromium
// cannot satisfy a post-lock request without re-entering main-process
// admission. The ThumbService owns any safe in-memory reuse.
// Scheme privileges register in main/protocol-privileges.ts (Electron allows
// exactly one registerSchemesAsPrivileged call).

/** Call once after app ready; the service is created lazily like the library. */
export function registerThumbProtocol(
  getService: () => ThumbService,
  admit: () => void = () => undefined,
  getProtected?: (() => ProtectedMediaService) | undefined,
): void {
  protocol.handle(THUMB_SCHEME, (request) => handleThumbRequest(getService, admit, request, getProtected));
}
