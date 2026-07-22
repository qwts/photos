import { z } from 'zod';

import { interopReviewCategorySchema, interopTransferPhaseSchema } from './contract.js';
import { interopCountsSchema, interopErrorSchema } from './messages.js';
import { interopPairingStateSchema, interopProviderStateSchema } from './runtime-state.js';

export const incomingMoveItemSchema = z
  .object({
    interopId: z.string().uuid(),
    label: z.string().min(1).max(160),
    reviewCategory: interopReviewCategorySchema,
    original: z.enum(['available', 'metadata-only', 'unavailable']),
    outcome: z.enum(['pending', 'accepted', 'retained', 'failed']),
    reason: z.string().min(1).max(240).nullable(),
  })
  .strict();

export const incomingMoveBatchSchema = z
  .object({
    transferId: z.string().uuid(),
    items: z.array(incomingMoveItemSchema).readonly(),
    counts: interopCountsSchema,
  })
  .strict();

export const inboundMoveProgressSchema = z
  .object({
    transferId: z.string().uuid().nullable(),
    phase: interopTransferPhaseSchema,
    processed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    retained: z.number().int().nonnegative(),
  })
  .strict();

export const interopInboundStatusSchema = z
  .object({
    provider: interopProviderStateSchema,
    pairing: interopPairingStateSchema,
    batches: z.array(incomingMoveBatchSchema).readonly(),
    selectedTransferId: z.string().uuid().nullable(),
    progress: inboundMoveProgressSchema,
    error: interopErrorSchema.nullable(),
  })
  .strict();

export type IncomingMoveItemStatus = z.output<typeof incomingMoveItemSchema>;
export type IncomingMoveBatchStatus = z.output<typeof incomingMoveBatchSchema>;
export type InboundMoveProgress = z.output<typeof inboundMoveProgressSchema>;
export type InteropInboundStatus = z.output<typeof interopInboundStatusSchema>;
