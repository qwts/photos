import { z } from 'zod';

export const INTEROP_MAGIC = 'OVERLOOK-IMAGE-TRAIL-INTEROP';
export const INTEROP_CONTRACT_VERSION = 1;

export const interopProductSchema = z.enum(['image-trail', 'overlook']);
export const interopOperationSchema = z.enum(['move', 'sync']);
export const interopMessageKindSchema = z.enum(['manifest', 'record', 'blob', 'acknowledgement', 'journal', 'error']);

export const interopReviewCategorySchema = z.enum(['eligible', 'duplicate', 'conflict', 'metadata-only', 'unsupported', 'skipped']);

export const interopConflictActionSchema = z.enum(['keep-image-trail', 'keep-overlook', 'keep-both']);

export const interopTransferPhaseSchema = z.enum([
  'queued',
  'reviewing',
  'transferring',
  'paused',
  'awaiting-acknowledgement',
  'acknowledged',
  'finalizing',
  'completed',
  'cancelled',
  'failed',
]);

export const interopErrorCodeSchema = z.enum([
  'offline',
  'auth-expired',
  'quota',
  'provider-unavailable',
  'partial-failure',
  'interrupted',
  'wrong-key',
  'corrupt',
  'replay',
  'unsupported-version',
  'unsupported-record',
]);

export const interopRevisionVectorSchema = z
  .object({
    imageTrail: z.number().int().nonnegative(),
    overlook: z.number().int().nonnegative(),
  })
  .strict();

export const interopFieldRevisionsSchema = z
  .object({
    title: interopRevisionVectorSchema.optional(),
    label: interopRevisionVectorSchema.optional(),
    sourceUrl: interopRevisionVectorSchema.optional(),
    dimensions: interopRevisionVectorSchema.optional(),
    thumbnail: interopRevisionVectorSchema.optional(),
    timestamps: interopRevisionVectorSchema.optional(),
    original: interopRevisionVectorSchema.optional(),
    albums: interopRevisionVectorSchema.optional(),
    sourceCompatibility: interopRevisionVectorSchema.optional(),
    roundTripMetadata: interopRevisionVectorSchema.optional(),
    deleted: interopRevisionVectorSchema.optional(),
  })
  .strict();

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const interopIdentitySchema = z
  .object({
    interopId: z.string().uuid(),
    origin: z
      .object({
        product: interopProductSchema,
        localId: z.string().min(1),
      })
      .strict(),
    contentHash: sha256Schema.nullable(),
  })
  .strict();

export const interopHeaderSchema = z
  .object({
    magic: z.literal(INTEROP_MAGIC),
    contractVersion: z.literal(INTEROP_CONTRACT_VERSION),
    messageId: z.string().uuid(),
    transferId: z.string().uuid(),
    pairingId: z.string().uuid(),
    sourceProduct: interopProductSchema,
    targetProduct: interopProductSchema,
    operation: interopOperationSchema,
    kind: interopMessageKindSchema,
    createdAt: z.string().datetime(),
    sequence: z.number().int().nonnegative(),
  })
  .strict()
  .refine((header) => header.sourceProduct !== header.targetProduct, {
    message: 'sourceProduct and targetProduct must differ',
    path: ['targetProduct'],
  });

export type InteropProduct = z.output<typeof interopProductSchema>;
export type InteropOperation = z.output<typeof interopOperationSchema>;
export type InteropReviewCategory = z.output<typeof interopReviewCategorySchema>;
export type InteropConflictAction = z.output<typeof interopConflictActionSchema>;
export type InteropTransferPhase = z.output<typeof interopTransferPhaseSchema>;
export type InteropErrorCode = z.output<typeof interopErrorCodeSchema>;
export type InteropRevisionVector = z.output<typeof interopRevisionVectorSchema>;
export type InteropFieldRevisions = z.output<typeof interopFieldRevisionsSchema>;
export type InteropIdentity = z.output<typeof interopIdentitySchema>;
export type InteropHeader = z.output<typeof interopHeaderSchema>;
