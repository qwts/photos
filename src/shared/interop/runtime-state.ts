import { z } from 'zod';

export const interopPairingStateSchema = z
  .object({
    status: z.enum(['not-configured', 'locked', 'unlocked']),
    pairingId: z.string().uuid().nullable(),
    keyId: z
      .string()
      .regex(/^interop:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
      .nullable(),
    createdAt: z.string().datetime().nullable(),
  })
  .strict();

export const interopProviderStateSchema = z
  .object({
    provider: z.literal('pcloud'),
    status: z.enum(['not-connected', 'connected', 'expired']),
    busy: z.boolean(),
  })
  .strict();

export type InteropPairingState = z.output<typeof interopPairingStateSchema>;
export type InteropProviderState = z.output<typeof interopProviderStateSchema>;
