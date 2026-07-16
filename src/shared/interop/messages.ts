import { z } from 'zod';

import {
  interopConflictActionSchema,
  interopErrorCodeSchema,
  interopHeaderSchema,
  interopReviewCategorySchema,
  interopTransferPhaseSchema,
} from './contract.js';
import { interopAlbumSchema, interopBlobReferenceSchema, interopRecordSchema } from './records.js';

export const interopCountsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    eligible: z.number().int().nonnegative(),
    duplicate: z.number().int().nonnegative(),
    conflict: z.number().int().nonnegative(),
    metadataOnly: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    acknowledged: z.number().int().nonnegative(),
    finalized: z.number().int().nonnegative(),
  })
  .strict();

export const interopErrorSchema = z
  .object({
    code: interopErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
    recordInteropId: z.string().uuid().nullable(),
  })
  .strict();

const manifestPayloadSchema = z
  .object({
    kind: z.literal('manifest'),
    schemaVersion: z.literal(1),
    recordInteropIds: z.array(z.string().uuid()).readonly(),
    albumInteropIds: z.array(z.string().uuid()).readonly(),
    blobCount: z.number().int().nonnegative(),
    counts: interopCountsSchema,
  })
  .strict();

const recordPayloadSchema = z
  .object({
    kind: z.literal('record'),
    schemaVersion: z.literal(1),
    record: interopRecordSchema,
    albums: z.array(interopAlbumSchema).readonly(),
    reviewCategory: interopReviewCategorySchema,
  })
  .strict();

const safeRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith('/') &&
      !path.includes('\\') &&
      !path.includes(':') &&
      path.split('/').every((segment) => segment !== '' && segment !== '..'),
    'path must be a safe provider-relative path',
  );

const blobPayloadSchema = z
  .object({
    kind: z.literal('blob'),
    schemaVersion: z.literal(1),
    recordInteropId: z.string().uuid(),
    role: z.enum(['original', 'thumbnail']),
    blob: interopBlobReferenceSchema,
    encryptedPath: safeRelativePathSchema,
    chunkIndex: z.number().int().nonnegative(),
    chunkCount: z.number().int().positive(),
  })
  .strict()
  .refine((payload) => payload.chunkIndex < payload.chunkCount, {
    message: 'chunkIndex must be less than chunkCount',
    path: ['chunkIndex'],
  });

const acknowledgementPayloadSchema = z
  .object({
    kind: z.literal('acknowledgement'),
    schemaVersion: z.literal(1),
    status: z.enum(['accepted', 'rejected']),
    recordInteropId: z.string().uuid(),
    targetLocalId: z.string().min(1).nullable(),
    metadataPersisted: z.boolean(),
    originalVerification: z.enum(['verified', 'metadata-only', 'unavailable']),
    acknowledgedMessageIds: z.array(z.string().uuid()).min(1).readonly(),
    errors: z.array(interopErrorSchema).readonly(),
  })
  .strict();

const journalPayloadSchema = z
  .object({
    kind: z.literal('journal'),
    schemaVersion: z.literal(1),
    phase: interopTransferPhaseSchema,
    counts: interopCountsSchema,
    lastSequence: z.number().int().nonnegative(),
    conflictDecisions: z.record(z.string().uuid(), interopConflictActionSchema),
    reviewedDeleteInteropIds: z.array(z.string().uuid()).readonly(),
    errors: z.array(interopErrorSchema).readonly(),
  })
  .strict();

const errorPayloadSchema = z
  .object({
    kind: z.literal('error'),
    schemaVersion: z.literal(1),
    error: interopErrorSchema,
  })
  .strict();

export const interopPayloadSchema = z.discriminatedUnion('kind', [
  manifestPayloadSchema,
  recordPayloadSchema,
  blobPayloadSchema,
  acknowledgementPayloadSchema,
  journalPayloadSchema,
  errorPayloadSchema,
]);

export const interopEnvelopeSchema = z
  .object({
    header: interopHeaderSchema,
    payload: interopPayloadSchema,
  })
  .strict()
  .refine((envelope) => envelope.header.kind === envelope.payload.kind, {
    message: 'header and payload kinds must match',
    path: ['payload', 'kind'],
  });

export type InteropCounts = z.output<typeof interopCountsSchema>;
export type InteropError = z.output<typeof interopErrorSchema>;
export type InteropPayload = z.output<typeof interopPayloadSchema>;
export type InteropEnvelope = z.output<typeof interopEnvelopeSchema>;
