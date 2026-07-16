import type { ThumbUrlSize } from '../../shared/library/thumb-url.js';
import { FullService, type FullPayload } from '../fullres/full-service.js';
import { ThumbService, type LoadedThumb } from '../thumbs/thumb-service.js';
import type { ProtectedAlbumAuthorityRegistry } from '../crypto/protected-album-authority.js';
import type { ProtectedLibraryService } from './protected-library-service.js';

function mediaKey(albumId: string, photoId: string): string {
  return JSON.stringify([albumId, photoId]);
}

function parseMediaKey(value: string): { readonly albumId: string; readonly photoId: string } | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const values: readonly unknown[] = parsed;
    const albumId = values[0];
    const photoId = values[1];
    if (values.length !== 2 || typeof albumId !== 'string' || albumId === '' || typeof photoId !== 'string' || photoId === '') return null;
    return { albumId, photoId };
  } catch {
    return null;
  }
}

export interface ProtectedMediaServiceOptions {
  readonly library: ProtectedLibraryService;
  readonly authorities: ProtectedAlbumAuthorityRegistry;
  readonly thumbCacheBytes?: number | undefined;
  readonly fullCacheBytes?: number | undefined;
}

/** Domain-scoped decrypted media cache. Album relock revokes completed and
 * in-flight generations before a stale protocol request can settle. */
export class ProtectedMediaService {
  private readonly keysByAlbum = new Map<string, Set<string>>();
  private readonly thumbs: ThumbService;
  private readonly full: FullService;
  private readonly stopRevocations: () => void;

  constructor(private readonly options: ProtectedMediaServiceOptions) {
    const admit = (key: string): boolean => {
      const target = parseMediaKey(key);
      return target !== null && this.options.library.isAuthorizedPhoto(target.albumId, target.photoId);
    };
    this.thumbs = new ThumbService({
      admit,
      loadThumb: async (key, size) => {
        const target = parseMediaKey(key);
        if (target === null) return null;
        try {
          const loaded = await this.options.library.media(target.albumId, target.photoId, size);
          return { bytes: loaded.bytes, contentHash: loaded.opaqueRef };
        } catch {
          return null;
        }
      },
      maxCacheBytes: options.thumbCacheBytes,
    });
    this.full = new FullService({
      admit,
      loadOriginal: async (key) => {
        const target = parseMediaKey(key);
        if (target === null) return null;
        try {
          const loaded = await this.options.library.media(target.albumId, target.photoId, 'original');
          return { bytes: loaded.bytes, contentHash: loaded.opaqueRef, fileKind: loaded.fileKind };
        } catch {
          return null;
        }
      },
      maxCacheBytes: options.fullCacheBytes,
    });
    this.stopRevocations = options.authorities.onRevoked((albumId) => this.revoke(albumId));
  }

  getThumb(albumId: string, photoId: string, size: ThumbUrlSize, signal?: AbortSignal): Promise<LoadedThumb | null> {
    const key = this.track(albumId, photoId);
    return this.thumbs.getThumb(key, size, signal);
  }

  getFull(albumId: string, photoId: string, signal?: AbortSignal): Promise<FullPayload | null> {
    const key = this.track(albumId, photoId);
    return this.full.getFull(key, signal);
  }

  prefetch(albumId: string, photoIds: readonly string[]): void {
    this.full.prefetch(photoIds.map((photoId) => this.track(albumId, photoId)));
  }

  isAuthorized(albumId: string, photoId: string): boolean {
    return this.options.library.isAuthorizedPhoto(albumId, photoId);
  }

  stats(): { readonly thumbBytes: number; readonly fullBytes: number } {
    return { thumbBytes: this.thumbs.stats().cachedBytes, fullBytes: this.full.stats().cachedBytes };
  }

  async close(): Promise<void> {
    this.stopRevocations();
    await Promise.all([this.thumbs.close(), this.full.close()]);
    this.keysByAlbum.clear();
  }

  private track(albumId: string, photoId: string): string {
    const key = mediaKey(albumId, photoId);
    const keys = this.keysByAlbum.get(albumId) ?? new Set<string>();
    keys.add(key);
    this.keysByAlbum.set(albumId, keys);
    return key;
  }

  private revoke(albumId: string): void {
    const keys = this.keysByAlbum.get(albumId);
    if (keys === undefined) return;
    for (const key of keys) {
      this.thumbs.invalidate(key);
      this.full.invalidate(key);
    }
    this.keysByAlbum.delete(albumId);
  }
}
