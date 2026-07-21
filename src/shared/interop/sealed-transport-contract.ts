import { z } from 'zod';

export const INTEROP_SEALED_MESSAGE_MAGIC = 'OVERLOOK-IMAGE-TRAIL-SEALED-MESSAGE';
export const INTEROP_SEALED_BLOB_MAGIC = 'OVERLOOK-IMAGE-TRAIL-SEALED-BLOB';
export const INTEROP_SEALED_TRANSPORT_VERSION = 1;
export const INTEROP_SEALED_HEADER_MAX_BYTES = 8 * 1024;
export const INTEROP_MESSAGE_AAD_CONTEXT = 'overlook-image-trail/message/v1';

const canonicalBase64Schema = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
const uuidSchema = z.string().uuid();
const keyIdSchema = z.string().regex(/^interop:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const ivSchema = z.string().regex(/^[A-Za-z0-9+/]{16}$/u, 'AES-GCM IV must be canonical Base64 encoding exactly 12 bytes.');

export const interopSealedMessageSchema = z
  .object({
    magic: z.literal(INTEROP_SEALED_MESSAGE_MAGIC),
    schemaVersion: z.literal(INTEROP_SEALED_TRANSPORT_VERSION),
    pairingId: uuidSchema,
    transferId: uuidSchema,
    messageId: uuidSchema,
    keyId: keyIdSchema,
    cipher: z
      .object({
        name: z.literal('AES-GCM'),
        iv: ivSchema,
        ciphertext: canonicalBase64Schema.min(24),
      })
      .strict(),
  })
  .strict();

export const interopSealedBlobHeaderSchema = z
  .object({
    magic: z.literal(INTEROP_SEALED_BLOB_MAGIC),
    schemaVersion: z.literal(INTEROP_SEALED_TRANSPORT_VERSION),
    pairingId: uuidSchema,
    keyId: keyIdSchema,
    cipher: z.object({ name: z.literal('AES-GCM'), iv: ivSchema }).strict(),
  })
  .strict();

export const interopSealedBlobDescriptorSchema = z
  .object({
    schemaVersion: z.literal(INTEROP_SEALED_TRANSPORT_VERSION),
    transferId: uuidSchema,
    recordInteropId: uuidSchema,
    role: z.literal('original'),
    blobId: z.string().min(1),
    mimeType: z.string().min(1),
    byteLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    contentHash: sha256Schema,
  })
  .strict();

export type InteropSealedMessage = z.output<typeof interopSealedMessageSchema>;
export type InteropSealedBlobHeader = z.output<typeof interopSealedBlobHeaderSchema>;
export type InteropSealedBlobDescriptor = z.output<typeof interopSealedBlobDescriptorSchema>;

const MAX_SEQUENCE = 999_999_999_999;

function sequenceSegment(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > MAX_SEQUENCE) {
    throw new Error('Interop message sequence is invalid.');
  }
  return String(sequence).padStart(12, '0');
}

export function moveOutboxMessagePath(sequence: number, messageId: string): string {
  return `messages/outbox/${sequenceSegment(sequence)}-${uuidSchema.parse(messageId)}.json.aesgcm`;
}

export function moveAcknowledgementPath(sequence: number, messageId: string): string {
  return `messages/acknowledgements/${sequenceSegment(sequence)}-${uuidSchema.parse(messageId)}.json.aesgcm`;
}

export function moveOriginalBlobPath(recordInteropId: string): string {
  return `blobs/${uuidSchema.parse(recordInteropId)}/original.bin.aesgcm`;
}
