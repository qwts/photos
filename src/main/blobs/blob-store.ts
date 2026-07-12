import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { link, mkdir, open, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { createDecryptStream, createEncryptStream } from '../crypto/envelope.js';
import type { EnvelopeKey, KeyResolver } from '../crypto/envelope.js';

// Content-addressed encrypted blob store per ADR-0005 (#70). Plaintext never
// touches disk: bytes stream through the #67 envelope into tmp/, are fsynced,
// then atomically renamed to their hash-derived home. fsync policy: fsync the
// staged file before rename; fsync the destination directory after rename so
// the entry itself is durable (recorded per the issue).

export interface BlobRef {
  readonly contentHash: string;
  readonly keyId: number;
  readonly bytes: number;
}

export type ThumbSize = 'thumb' | 'mid';

export class BlobStoreError extends Error {
  override readonly name = 'BlobStoreError';
}

export interface BlobStoreOptions {
  /** Library data directory (ADR-0005 layout root). */
  readonly dataDir: string;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function assertHash(hash: string): void {
  if (!HASH_PATTERN.test(hash)) {
    throw new BlobStoreError('content hash must be 64 lowercase hex characters');
  }
}

function isErrno(error: unknown, code: string): boolean {
  // type-coverage:ignore-next-line -- narrowing the fs error shape
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

/** Reads the key id out of an existing envelope header (magic|ver|keyId). */
async function readEnvelopeKeyId(path: string): Promise<number> {
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(9);
    await handle.read(header, 0, 9, 0);
    if (header.subarray(0, 4).toString('ascii') !== 'OVLK') {
      throw new BlobStoreError(`existing blob at ${path} is not an Overlook envelope`);
    }
    return header.readUInt32BE(5);
  } finally {
    await handle.close();
  }
}

async function fsyncDir(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class BlobStore {
  private readonly blobsDir: string;
  private readonly thumbsDir: string;
  private readonly tmpDir: string;

  constructor(options: BlobStoreOptions) {
    this.blobsDir = join(options.dataDir, 'blobs');
    this.thumbsDir = join(options.dataDir, 'thumbs');
    this.tmpDir = join(options.dataDir, 'tmp');
  }

  async init(): Promise<void> {
    await mkdir(this.blobsDir, { recursive: true });
    await mkdir(this.thumbsDir, { recursive: true });
    await mkdir(this.tmpDir, { recursive: true });
  }

  private originalPath(contentHash: string): string {
    return join(this.blobsDir, contentHash.slice(0, 2), contentHash.slice(2, 4), contentHash);
  }

  private thumbPath(contentHash: string, size: ThumbSize): string {
    return join(this.thumbsDir, contentHash.slice(0, 2), `${contentHash}.${size}`);
  }

  /** Streams plaintext into an encrypted, content-addressed original. */
  async putOriginal(plaintext: Readable, key: EnvelopeKey, photoId: string): Promise<BlobRef> {
    return this.put(plaintext, key, photoId, (hash) => this.originalPath(hash));
  }

  /** Same envelope path for derivatives; addressed by ORIGINAL hash + size. */
  async putThumb(plaintext: Readable, key: EnvelopeKey, photoId: string, originalHash: string, size: ThumbSize): Promise<BlobRef> {
    assertHash(originalHash);
    return this.put(plaintext, key, photoId, () => this.thumbPath(originalHash, size));
  }

  private async put(
    plaintext: Readable,
    key: EnvelopeKey,
    photoId: string,
    destination: (contentHash: string) => string,
  ): Promise<BlobRef> {
    const stagePath = join(this.tmpDir, `stage-${randomBytes(8).toString('hex')}`);
    const hasher = createHash('sha256');
    let plainBytes = 0;
    plaintext.on('data', (chunk: Buffer) => {
      hasher.update(chunk);
      plainBytes += chunk.length;
    });

    const out = createWriteStream(stagePath, { flags: 'wx' });
    try {
      await pipeline(plaintext, createEncryptStream(key, { photoId }), out);
      // Durability point 1: the staged ciphertext itself.
      const handle = await open(stagePath, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      const contentHash = hasher.digest('hex');
      const finalPath = destination(contentHash);
      await mkdir(dirname(finalPath), { recursive: true });
      // Atomic no-replace publish: link() fails with EEXIST instead of
      // clobbering. A collision means these bytes are already stored under
      // an envelope whose AAD binds the ORIGINAL photo id — replacing it
      // would orphan that row's decrypts (PR #150 review). Keep the existing
      // envelope and report its true key id.
      try {
        await link(stagePath, finalPath);
      } catch (error) {
        if (isErrno(error, 'EEXIST')) {
          await rm(stagePath, { force: true });
          return { contentHash, keyId: await readEnvelopeKeyId(finalPath), bytes: plainBytes };
        }
        throw error;
      }
      await rm(stagePath, { force: true });
      // Durability point 2: the directory entry.
      await fsyncDir(dirname(finalPath));
      return { contentHash, keyId: key.id, bytes: plainBytes };
    } catch (error) {
      await rm(stagePath, { force: true });
      throw error;
    }
  }

  /** Decrypting read stream for an original. */
  getStream(contentHash: string, resolveKey: KeyResolver, photoId: string): Readable {
    assertHash(contentHash);
    const path = this.originalPath(contentHash);
    if (!existsSync(path)) {
      throw new BlobStoreError(`blob ${contentHash} is not in the store`);
    }
    return createReadStream(path).pipe(createDecryptStream(resolveKey, { photoId }));
  }

  getThumbStream(originalHash: string, size: ThumbSize, resolveKey: KeyResolver, photoId: string): Readable {
    assertHash(originalHash);
    const path = this.thumbPath(originalHash, size);
    if (!existsSync(path)) {
      throw new BlobStoreError(`thumb ${originalHash}.${size} is not in the store`);
    }
    return createReadStream(path).pipe(createDecryptStream(resolveKey, { photoId }));
  }

  async deleteOriginal(contentHash: string): Promise<void> {
    assertHash(contentHash);
    await rm(this.originalPath(contentHash), { force: true });
  }

  async deleteThumbs(originalHash: string): Promise<void> {
    assertHash(originalHash);
    await rm(this.thumbPath(originalHash, 'thumb'), { force: true });
    await rm(this.thumbPath(originalHash, 'mid'), { force: true });
  }

  /** Full integrity walk: decrypts the blob (every auth tag) and re-checks
   * the content address. */
  async verifyOriginal(contentHash: string, resolveKey: KeyResolver, photoId: string): Promise<boolean> {
    assertHash(contentHash);
    const hasher = createHash('sha256');
    try {
      const stream = this.getStream(contentHash, resolveKey, photoId);
      // type-coverage:ignore-next-line -- Readable yields untyped chunks
      for await (const chunk of stream) {
        // type-coverage:ignore-next-line -- Readable yields untyped chunks
        hasher.update(chunk as Buffer);
      }
    } catch {
      return false;
    }
    return hasher.digest('hex') === contentHash;
  }

  /** Repair-story helper (M11): staging leftovers + originals not in `known`. */
  async scanOrphans(known: ReadonlySet<string>): Promise<{ staged: string[]; unknown: string[] }> {
    const staged = (await readdir(this.tmpDir)).map((name) => join(this.tmpDir, name));
    const unknown: string[] = [];
    for (const level1 of await readdir(this.blobsDir).catch(() => [] as string[])) {
      for (const level2 of await readdir(join(this.blobsDir, level1)).catch(() => [] as string[])) {
        for (const file of await readdir(join(this.blobsDir, level1, level2)).catch(() => [] as string[])) {
          if (!known.has(file)) {
            unknown.push(join(this.blobsDir, level1, level2, file));
          }
        }
      }
    }
    return { staged, unknown };
  }
}
