import { z } from 'zod';

import { interopFieldRevisionsSchema, interopIdentitySchema, interopProductSchema, interopRevisionVectorSchema } from './contract.js';
import { interopJsonObjectSchema } from './json.js';

export const interopDimensionsSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const interopTimestampsSchema = z
  .object({
    bookmarkedAt: z.string().datetime().nullable(),
    capturedAt: z.string().datetime().nullable(),
    downloadedAt: z.string().datetime().nullable(),
    takenAt: z.string().datetime().nullable(),
    importedAt: z.string().datetime().nullable(),
  })
  .strict();

const availableBlobSchema = z
  .object({
    state: z.literal('available'),
    blobId: z.string().min(1),
    mimeType: z.string().min(1),
    byteLength: z.number().int().nonnegative(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

const unavailableBlobSchema = z
  .object({
    state: z.enum(['metadata-only', 'unavailable']),
    blobId: z.null(),
    mimeType: z.string().min(1).nullable(),
    byteLength: z.number().int().nonnegative().nullable(),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    reason: z.enum(['not-captured', 'missing', 'provider-unavailable', 'unsupported-format']),
  })
  .strict();

export const interopBlobReferenceSchema = z.discriminatedUnion('state', [availableBlobSchema, unavailableBlobSchema]);

export const interopRoundTripMetadataSchema = z
  .object({
    imageTrail: interopJsonObjectSchema,
    overlook: interopJsonObjectSchema,
  })
  .strict();

export const interopRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    identity: interopIdentitySchema,
    revision: interopRevisionVectorSchema,
    fieldRevisions: interopFieldRevisionsSchema,
    recordKind: z.enum(['web-bookmark', 'photo']),
    title: z.string().min(1).nullable(),
    label: z.string().min(1).nullable(),
    sourceUrl: z.string().url().nullable(),
    dimensions: interopDimensionsSchema.nullable(),
    timestamps: interopTimestampsSchema,
    sourceCompatibility: z.string().min(1).nullable(),
    original: interopBlobReferenceSchema,
    thumbnail: interopBlobReferenceSchema,
    albumIds: z.array(z.string().uuid()).readonly(),
    roundTripMetadata: interopRoundTripMetadataSchema,
    deletedAt: z.string().datetime().nullable(),
  })
  .strict();

export const interopAlbumMemberSchema = z
  .object({
    recordInteropId: z.string().uuid(),
    position: z.number().int().nonnegative(),
    revision: interopRevisionVectorSchema,
  })
  .strict();

export const interopAlbumSchema = z
  .object({
    schemaVersion: z.literal(1),
    interopId: z.string().uuid(),
    origin: z
      .object({
        product: interopProductSchema,
        localId: z.string().min(1),
      })
      .strict(),
    revision: interopRevisionVectorSchema,
    name: z.string().min(1),
    members: z.array(interopAlbumMemberSchema).readonly(),
    roundTripMetadata: interopRoundTripMetadataSchema,
    deletedAt: z.string().datetime().nullable(),
  })
  .strict();

export type InteropBlobReference = z.output<typeof interopBlobReferenceSchema>;
export type InteropRecord = z.output<typeof interopRecordSchema>;
export type InteropAlbum = z.output<typeof interopAlbumSchema>;
