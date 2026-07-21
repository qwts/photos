import { z } from 'zod';

import { activityEventTypes } from './types.js';

const payloadValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const activityEventSchema = z.object({
  sequence: z.number().int().positive(),
  eventId: z.string().min(1),
  operationId: z.string().min(1),
  eventType: z.enum(activityEventTypes),
  schemaVersion: z.literal(1),
  occurredAt: z.string(),
  actorClass: z.enum(['local-user', 'system', 'interop-peer', 'recovery']),
  rootCorrelationId: z.string().min(1),
  causationEventId: z.string().nullable(),
  entityIds: z.array(z.string()).readonly(),
  outcome: z.enum(['succeeded', 'partial', 'failed']),
  payload: z.record(z.string(), payloadValueSchema).readonly(),
  supersedesEventId: z.string().nullable(),
});

export const activityPageRequestSchema = z.object({
  limit: z.number().int().positive().max(100),
  cursor: z.number().int().positive().optional(),
});
export const activityPageResponseSchema = z.object({
  events: z.array(activityEventSchema).readonly(),
  nextCursor: z.number().int().positive().nullable(),
});
