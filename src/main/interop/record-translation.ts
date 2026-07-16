import { createHash } from 'node:crypto';

import type { InteropJsonObject } from '../../shared/interop/json.js';
import { interopJsonObjectSchema } from '../../shared/interop/json.js';
import {
  interopAlbumSchema,
  interopRecordSchema,
  type InteropAlbum,
  type InteropBlobReference,
  type InteropRecord,
} from '../../shared/interop/records.js';

export interface ImageTrailStoredOriginal {
  readonly blobId: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly capturedAt: string;
}

export interface ImageTrailProtectedPin {
  readonly schemaVersion: 1;
  readonly plainPinId: string;
  readonly encryptedPinId?: string | undefined;
  readonly encryptedThumbnailId?: string | undefined;
  readonly storedOriginalBlobId?: string | undefined;
  readonly queueUpdatedAt: string;
  readonly hasEncryptedMetadata: boolean;
  readonly hasEncryptedThumbnail: boolean;
  readonly hasStoredOriginal: boolean;
}

export interface ImageTrailBookmarkPayload {
  readonly url: string;
  readonly title?: string | undefined;
  readonly label?: string | undefined;
  readonly thumbnail?: string | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly bookmarkedAt: string;
  readonly downloadedAt?: string | undefined;
  readonly capturedAt?: string | undefined;
  readonly sourceCompatibility?: 'favorites' | undefined;
  readonly storedOriginal?: ImageTrailStoredOriginal | undefined;
  readonly protectedPin?: ImageTrailProtectedPin | undefined;
  readonly [key: string]: unknown;
}

export interface ImageTrailBookmarkEntry {
  readonly uuid: string;
  readonly payload: ImageTrailBookmarkPayload;
}

export interface ImageTrailAlbumEntry {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly recordIds: readonly string[];
  readonly [key: string]: unknown;
}

const IMAGE_TRAIL_REVISION = { imageTrail: 1, overlook: 0 } as const;

function uuidFromBytes(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function deterministicInteropId(namespace: string, localId: string): string {
  const bytes = new Uint8Array(createHash('sha256').update(`${namespace}\0${localId}`, 'utf8').digest().subarray(0, 16));
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) throw new Error('Unable to derive interoperability identity.');
  bytes[6] = (versionByte & 0x0f) | 0x80;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  return uuidFromBytes(bytes);
}

function normalizedTimestamp(value: string | undefined): string | null {
  if (value === undefined) return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error('Invalid Image Trail timestamp.');
  return timestamp.toISOString();
}

function nonempty(value: string | undefined): string | null {
  return value === undefined || value.length === 0 ? null : value;
}

function dimensions(payload: ImageTrailBookmarkPayload): InteropRecord['dimensions'] {
  return payload.width !== undefined &&
    payload.height !== undefined &&
    Number.isSafeInteger(payload.width) &&
    Number.isSafeInteger(payload.height) &&
    payload.width > 0 &&
    payload.height > 0
    ? { width: payload.width, height: payload.height }
    : null;
}

function dataUrlMetadata(value: string): { readonly mimeType: string | null; readonly byteLength: number | null } {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/u.exec(value);
  if (!match) return { mimeType: null, byteLength: null };
  const mimeType = match[1] ?? null;
  const encoded = match[2];
  if (encoded === undefined) return { mimeType: null, byteLength: null };
  try {
    const bytes = Buffer.from(encoded, 'base64');
    return Buffer.from(bytes).toString('base64') === encoded
      ? { mimeType, byteLength: bytes.byteLength }
      : { mimeType: null, byteLength: null };
  } catch {
    return { mimeType: null, byteLength: null };
  }
}

function thumbnailReference(thumbnail: string | undefined): InteropBlobReference {
  if (thumbnail === undefined) {
    return { state: 'metadata-only', blobId: null, mimeType: null, byteLength: null, contentHash: null, reason: 'not-captured' };
  }
  const metadata = dataUrlMetadata(thumbnail);
  return {
    state: 'metadata-only',
    blobId: null,
    mimeType: metadata.mimeType,
    byteLength: metadata.byteLength,
    contentHash: null,
    reason: 'provider-unavailable',
  };
}

function originalReference(original: ImageTrailStoredOriginal | undefined): InteropBlobReference {
  if (original === undefined) {
    return { state: 'metadata-only', blobId: null, mimeType: null, byteLength: null, contentHash: null, reason: 'not-captured' };
  }
  return {
    state: 'unavailable',
    blobId: null,
    mimeType: original.mimeType,
    byteLength: original.byteLength,
    contentHash: null,
    reason: 'provider-unavailable',
  };
}

function roundTripImageTrail(value: object): InteropJsonObject {
  return interopJsonObjectSchema.parse(JSON.parse(JSON.stringify(value)) as unknown);
}

export function translateImageTrailBookmark(
  entry: ImageTrailBookmarkEntry,
  options: { readonly albumIds?: readonly string[] | undefined } = {},
): InteropRecord {
  const payload = entry.payload;
  const recordDimensions = dimensions(payload);
  const recordThumbnail = thumbnailReference(payload.thumbnail);
  const recordOriginal = originalReference(payload.storedOriginal);
  const fieldRevisions = {
    sourceUrl: IMAGE_TRAIL_REVISION,
    timestamps: IMAGE_TRAIL_REVISION,
    original: IMAGE_TRAIL_REVISION,
    roundTripMetadata: IMAGE_TRAIL_REVISION,
    ...(nonempty(payload.title) === null ? {} : { title: IMAGE_TRAIL_REVISION }),
    ...(nonempty(payload.label) === null ? {} : { label: IMAGE_TRAIL_REVISION }),
    ...(recordDimensions === null ? {} : { dimensions: IMAGE_TRAIL_REVISION }),
    ...(payload.thumbnail === undefined ? {} : { thumbnail: IMAGE_TRAIL_REVISION }),
    ...(payload.sourceCompatibility === undefined ? {} : { sourceCompatibility: IMAGE_TRAIL_REVISION }),
    ...((options.albumIds?.length ?? 0) === 0 ? {} : { albums: IMAGE_TRAIL_REVISION }),
  };
  return interopRecordSchema.parse({
    schemaVersion: 1,
    identity: {
      interopId: deterministicInteropId('image-trail', entry.uuid),
      origin: { product: 'image-trail', localId: entry.uuid },
      contentHash: null,
    },
    revision: IMAGE_TRAIL_REVISION,
    fieldRevisions,
    recordKind: 'web-bookmark',
    title: nonempty(payload.title),
    label: nonempty(payload.label),
    sourceUrl: payload.url,
    dimensions: recordDimensions,
    timestamps: {
      bookmarkedAt: normalizedTimestamp(payload.bookmarkedAt),
      capturedAt: normalizedTimestamp(payload.capturedAt),
      downloadedAt: normalizedTimestamp(payload.downloadedAt),
      takenAt: null,
      importedAt: null,
    },
    sourceCompatibility: payload.sourceCompatibility ?? null,
    original: recordOriginal,
    thumbnail: recordThumbnail,
    albumIds: options.albumIds ?? [],
    roundTripMetadata: { imageTrail: roundTripImageTrail(payload), overlook: {} },
    deletedAt: null,
  });
}

export function translateImageTrailAlbum(entry: ImageTrailAlbumEntry, recordIds: ReadonlyMap<string, string>): InteropAlbum {
  const members = entry.recordIds.flatMap((localId, position) => {
    const recordInteropId = recordIds.get(localId);
    return recordInteropId === undefined ? [] : [{ recordInteropId, position, revision: IMAGE_TRAIL_REVISION }];
  });
  return interopAlbumSchema.parse({
    schemaVersion: 1,
    interopId: deterministicInteropId('image-trail-album', entry.id),
    origin: { product: 'image-trail', localId: entry.id },
    revision: IMAGE_TRAIL_REVISION,
    name: entry.name,
    members,
    roundTripMetadata: { imageTrail: roundTripImageTrail(entry), overlook: {} },
    deletedAt: null,
  });
}
