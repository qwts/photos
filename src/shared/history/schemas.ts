import { z } from 'zod';

import { commandIdSchema } from '../commands/menu-contract.js';

const classification = z.enum(['immediately-reversible', 'conditionally-reversible', 'compensating-only', 'irreversible']);
const status = z.enum(['available', 'conditional', 'pending', 'expired', 'unavailable', 'irreversible']);
const reason = z.enum([
  'ready',
  'empty-stack',
  'expired',
  'state-changed',
  'resource-missing',
  'path-occupied',
  'permission-denied',
  'insufficient-space',
  'bytes-unavailable',
  'irreversible',
]);

export const capabilitySnapshotSchema = z.object({
  recordId: z.string().nullable(),
  commandId: commandIdSchema.nullable(),
  classification: classification.nullable(),
  status,
  reason,
  expiresAt: z.string().nullable(),
});

export const historyStatusSchema = z.object({ undo: capabilitySnapshotSchema, redo: capabilitySnapshotSchema });
export const historyExecuteRequestSchema = z.object({ requestId: z.string().min(1).max(200) });
export const historyExecuteResponseSchema = z.object({
  applied: z.boolean(),
  direction: z.enum(['undo', 'redo']),
  capability: capabilitySnapshotSchema,
});
