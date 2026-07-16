import { webcrypto } from 'node:crypto';

import { z } from 'zod';

import type { ImageTrailAlbumEntry, ImageTrailBookmarkEntry } from './record-translation.js';

const MAX_EXPORT_CHARACTERS = 64 * 1024 * 1024;
const PBKDF2_ITERATIONS = 600_000;
const timestampSchema = z.string().datetime({ offset: true });
const safeCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const storedOriginalSchema = z
  .object({
    blobId: z.string().min(1),
    mimeType: z.string().min(1),
    byteLength: safeCountSchema,
    capturedAt: timestampSchema,
  })
  .strict();

const protectedPinSchema = z
  .object({
    schemaVersion: z.literal(1),
    plainPinId: z.string().min(1),
    encryptedPinId: z.string().min(1).optional(),
    encryptedThumbnailId: z.string().min(1).optional(),
    storedOriginalBlobId: z.string().min(1).optional(),
    queueUpdatedAt: timestampSchema,
    hasEncryptedMetadata: z.boolean(),
    hasEncryptedThumbnail: z.boolean(),
    hasStoredOriginal: z.boolean(),
  })
  .passthrough();

const bookmarkPayloadSchema = z
  .object({
    url: z.string().url(),
    title: z.string().optional(),
    label: z.string().optional(),
    thumbnail: z.string().optional(),
    width: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    height: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    bookmarkedAt: timestampSchema,
    downloadedAt: timestampSchema.optional(),
    capturedAt: timestampSchema.optional(),
    sourceCompatibility: z.literal('favorites').optional(),
    storedOriginal: storedOriginalSchema.optional(),
    protectedPin: protectedPinSchema.optional(),
  })
  .passthrough();

const bookmarkEntrySchema = z
  .object({
    uuid: z.string().min(1),
    payload: bookmarkPayloadSchema,
  })
  .strict();

const albumEntrySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    recordIds: z.array(z.string().min(1)).readonly(),
  })
  .passthrough();

const plainEnvelopeSchema = z
  .object({
    format: z.literal('image-trail.records'),
    formatVersion: z.literal(1),
    payloadType: z.literal('bookmarks'),
    createdAt: timestampSchema,
    recordCount: safeCountSchema,
    entries: z.array(z.unknown()).readonly(),
  })
  .strict();

const encryptedEnvelopeSchema = z
  .object({
    header: z
      .object({
        magic: z.literal('IMAGE-TRAIL-EXPORT'),
        formatVersion: z.literal(1),
        payloadType: z.enum(['bookmarks', 'mixed']),
        algorithm: z.literal('AES-GCM'),
        wrappingMode: z.literal('password'),
        keyKind: z.literal('export'),
        keyReference: z.string().regex(/^export:.+$/u),
        salt: z.string().min(1),
        iv: z.string().min(1),
        iterations: z.literal(PBKDF2_ITERATIONS),
        createdAt: timestampSchema,
        recordCount: safeCountSchema,
      })
      .strict(),
    payload: z.string().min(1),
  })
  .strict();

const fullBackupSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    bookmarks: z.array(z.unknown()).readonly(),
    originalBlobs: z.array(z.unknown()).readonly(),
    blobKeyBackups: z.array(z.unknown()).readonly().optional(),
    missingOriginalBlobIds: z.array(z.string()).readonly().optional(),
    albums: z.array(z.unknown()).readonly().optional(),
  })
  .passthrough();

export interface ImageTrailCompatibilityImport {
  readonly entries: readonly ImageTrailBookmarkEntry[];
  readonly albums: readonly ImageTrailAlbumEntry[];
  readonly skipped: readonly string[];
  readonly skippedAlbums: readonly string[];
  readonly plaintext: boolean;
  readonly createdAt: string;
}

function parseJson(raw: string): unknown {
  if (raw.length > MAX_EXPORT_CHARACTERS) throw new Error('Image Trail export is too large.');
  return JSON.parse(raw) as unknown;
}

function decodeCanonicalBase64(value: string, byteLength?: number): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  if (Buffer.from(bytes).toString('base64') !== value || (byteLength !== undefined && bytes.byteLength !== byteLength)) {
    bytes.fill(0);
    throw new Error('Invalid base64.');
  }
  return bytes;
}

function parseRows(rows: readonly unknown[]): {
  readonly entries: readonly ImageTrailBookmarkEntry[];
  readonly skipped: readonly string[];
} {
  const entries: ImageTrailBookmarkEntry[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    const parsed = bookmarkEntrySchema.safeParse(row);
    if (parsed.success) entries.push(parsed.data);
    else skipped.push(typeof row === 'object' && row !== null && 'uuid' in row ? String(row.uuid) : 'unknown');
  }
  return { entries, skipped };
}

function parseAlbums(rows: readonly unknown[]): {
  readonly albums: readonly ImageTrailAlbumEntry[];
  readonly skippedAlbums: readonly string[];
} {
  const albums: ImageTrailAlbumEntry[] = [];
  const skippedAlbums: string[] = [];
  for (const row of rows) {
    const parsed = albumEntrySchema.safeParse(row);
    if (parsed.success) albums.push(parsed.data);
    else skippedAlbums.push(typeof row === 'object' && row !== null && 'id' in row ? String(row.id) : 'unknown');
  }
  return { albums, skippedAlbums };
}

function importedRows(
  value: unknown,
  recordCount: number,
): {
  readonly entries: readonly ImageTrailBookmarkEntry[];
  readonly albums: readonly ImageTrailAlbumEntry[];
  readonly skipped: readonly string[];
  readonly skippedAlbums: readonly string[];
} {
  const backup = fullBackupSchema.safeParse(value);
  const bookmarkRows = backup.success ? backup.data.bookmarks : value;
  if (!Array.isArray(bookmarkRows) || bookmarkRows.length !== recordCount) throw new Error('Image Trail record count mismatch.');
  const records = parseRows(bookmarkRows);
  const albums = parseAlbums(backup.success ? (backup.data.albums ?? []) : []);
  return { ...records, ...albums };
}

function importPlain(value: unknown): ImageTrailCompatibilityImport {
  const envelope = plainEnvelopeSchema.parse(value);
  if (envelope.recordCount !== envelope.entries.length) throw new Error('Image Trail record count mismatch.');
  const rows = parseRows(envelope.entries);
  return { ...rows, albums: [], skippedAlbums: [], plaintext: true, createdAt: new Date(envelope.createdAt).toISOString() };
}

async function decryptEncrypted(value: unknown, password: string | undefined): Promise<ImageTrailCompatibilityImport> {
  let salt: Uint8Array | undefined;
  let iv: Uint8Array | undefined;
  let ciphertext: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;
  try {
    const envelope = encryptedEnvelopeSchema.parse(value);
    if (password === undefined) throw new Error('Password required.');
    salt = decodeCanonicalBase64(envelope.header.salt, 16);
    iv = decodeCanonicalBase64(envelope.header.iv, 12);
    ciphertext = decodeCanonicalBase64(envelope.payload);
    const passwordBytes = new TextEncoder().encode(password);
    const baseKey = await (async () => {
      try {
        return await webcrypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey']);
      } finally {
        passwordBytes.fill(0);
      }
    })();
    const key = await webcrypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    plaintext = new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext));
    const rows = importedRows(parseJson(new TextDecoder().decode(plaintext)), envelope.header.recordCount);
    return { ...rows, plaintext: false, createdAt: new Date(envelope.header.createdAt).toISOString() };
  } catch {
    throw new Error('Wrong password, corrupt file, or unsupported export.');
  } finally {
    salt?.fill(0);
    iv?.fill(0);
    ciphertext?.fill(0);
    plaintext?.fill(0);
  }
}

export async function importImageTrailCompatibilityFile(raw: string, password?: string): Promise<ImageTrailCompatibilityImport> {
  let value: unknown;
  try {
    value = parseJson(raw);
  } catch {
    throw new Error('Invalid Image Trail export.');
  }
  if (typeof value === 'object' && value !== null && 'format' in value) {
    try {
      return importPlain(value);
    } catch {
      throw new Error('Invalid plain Image Trail export.');
    }
  }
  return decryptEncrypted(value, password);
}
