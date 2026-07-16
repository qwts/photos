import { z } from 'zod';

export const INTEROP_PAIRING_MAGIC = 'OVERLOOK-IMAGE-TRAIL-PAIRING';
export const INTEROP_PAIRING_FORMAT_VERSION = 1;
export const INTEROP_PAIRING_PBKDF2_ITERATIONS = 600_000;

const canonicalBase64Schema = z
  .string()
  .min(1)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
const interopKeyIdSchema = z.string().regex(/^interop:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);

export const interopPairingPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    pairingId: z.string().uuid(),
    keyId: interopKeyIdSchema,
    interopKey: canonicalBase64Schema,
    products: z.tuple([z.literal('image-trail'), z.literal('overlook')]),
    createdAt: z.string().datetime(),
  })
  .strict();

export const interopPairingBundleSchema = z
  .object({
    magic: z.literal(INTEROP_PAIRING_MAGIC),
    formatVersion: z.literal(INTEROP_PAIRING_FORMAT_VERSION),
    pairingId: z.string().uuid(),
    keyId: interopKeyIdSchema,
    createdAt: z.string().datetime(),
    kdf: z
      .object({
        name: z.literal('PBKDF2'),
        hash: z.literal('SHA-256'),
        iterations: z.literal(INTEROP_PAIRING_PBKDF2_ITERATIONS),
        salt: canonicalBase64Schema,
      })
      .strict(),
    cipher: z
      .object({
        name: z.literal('AES-256-GCM'),
        iv: canonicalBase64Schema,
        ciphertext: canonicalBase64Schema,
      })
      .strict(),
  })
  .strict();

export type InteropPairingPayload = z.output<typeof interopPairingPayloadSchema>;
export type InteropPairingBundle = z.output<typeof interopPairingBundleSchema>;
