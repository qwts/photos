const KEY_BYTES = 32;

export class ProtectedAlbumAuthorityError extends Error {
  override readonly name = 'ProtectedAlbumAuthorityError';
}

/** Main-process-only session custody. The registry owns every stored copy and
 * zeroizes it on replacement, relock, app lock, or library shutdown. */
export class ProtectedAlbumAuthorityRegistry {
  private readonly keys = new Map<string, Buffer>();

  authorize(albumId: string, albumKey: Buffer): void {
    if (albumId.length < 1 || albumId.length > 256) throw new ProtectedAlbumAuthorityError('album id is invalid');
    if (albumKey.length !== KEY_BYTES) throw new ProtectedAlbumAuthorityError('album key must be 32 bytes');
    const previous = this.keys.get(albumId);
    this.keys.set(albumId, Buffer.from(albumKey));
    previous?.fill(0);
  }

  isAuthorized(albumId: string): boolean {
    return this.keys.has(albumId);
  }

  /** The callback must not retain the Buffer; it is registry-owned and can be
   * zeroized by a lifecycle event immediately after this call. */
  withAuthority<T>(albumId: string, use: (albumKey: Buffer) => T): T {
    const key = this.keys.get(albumId);
    if (key === undefined) throw new ProtectedAlbumAuthorityError('protected album is locked');
    return use(key);
  }

  relock(albumId: string): boolean {
    const key = this.keys.get(albumId);
    if (key === undefined) return false;
    this.keys.delete(albumId);
    key.fill(0);
    return true;
  }

  relockAll(): void {
    for (const key of this.keys.values()) key.fill(0);
    this.keys.clear();
  }

  close(): void {
    this.relockAll();
  }
}
