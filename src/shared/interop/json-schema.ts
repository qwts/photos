import { z } from 'zod';

import { interopEnvelopeSchema } from './messages.js';
import { interopPairingBundleSchema } from './pairing-contract.js';
import {
  interopSealedBlobDescriptorSchema,
  interopSealedBlobHeaderSchema,
  interopSealedMessageSchema,
} from './sealed-transport-contract.js';

export const INTEROP_ENVELOPE_SCHEMA_FILE = 'interop-envelope.schema.json';
export const INTEROP_PAIRING_SCHEMA_FILE = 'pairing-bundle.schema.json';
export const INTEROP_SEALED_MESSAGE_SCHEMA_FILE = 'sealed-message.schema.json';
export const INTEROP_SEALED_BLOB_HEADER_SCHEMA_FILE = 'sealed-blob-header.schema.json';
export const INTEROP_SEALED_BLOB_DESCRIPTOR_SCHEMA_FILE = 'sealed-blob-descriptor.schema.json';

const SCHEMA_BASE_URI = 'https://github.com/qwts/photos/blob/main/design/handoff/contracts/v1';

function generateSchema(schema: z.ZodType, id: string, title: string, comment: string): unknown {
  return {
    ...z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      unrepresentable: 'throw',
      reused: 'ref',
      cycles: 'ref',
    }),
    $id: `${SCHEMA_BASE_URI}/${id}`,
    title,
    $comment: comment,
  };
}

export function createInteropJsonSchemas(): Readonly<Record<string, unknown>> {
  return {
    [INTEROP_ENVELOPE_SCHEMA_FILE]: generateSchema(
      interopEnvelopeSchema,
      INTEROP_ENVELOPE_SCHEMA_FILE,
      'Overlook and Image Trail interoperability envelope v1',
      'Runtime validation additionally enforces distinct source and target products, matching header and payload kinds, safe provider-relative paths, and bounded blob chunk indices.',
    ),
    [INTEROP_PAIRING_SCHEMA_FILE]: generateSchema(
      interopPairingBundleSchema,
      INTEROP_PAIRING_SCHEMA_FILE,
      'Overlook and Image Trail password-protected pairing bundle v1',
      'Opening the bundle additionally authenticates all header fields as AES-GCM AAD and verifies that the encrypted payload identity matches the header.',
    ),
    [INTEROP_SEALED_MESSAGE_SCHEMA_FILE]: generateSchema(
      interopSealedMessageSchema,
      INTEROP_SEALED_MESSAGE_SCHEMA_FILE,
      'Overlook and Image Trail AES-GCM sealed message v1',
      'The clear identity header is authenticated as canonical JSON AAD. Opening additionally verifies the decrypted envelope identity against that header.',
    ),
    [INTEROP_SEALED_BLOB_HEADER_SCHEMA_FILE]: generateSchema(
      interopSealedBlobHeaderSchema,
      INTEROP_SEALED_BLOB_HEADER_SCHEMA_FILE,
      'Overlook and Image Trail AES-GCM sealed blob header v1',
      'The exact UTF-8 JSON header bytes are authenticated as AES-GCM AAD. Descriptive original metadata remains encrypted.',
    ),
    [INTEROP_SEALED_BLOB_DESCRIPTOR_SCHEMA_FILE]: generateSchema(
      interopSealedBlobDescriptorSchema,
      INTEROP_SEALED_BLOB_DESCRIPTOR_SCHEMA_FILE,
      'Overlook and Image Trail encrypted original descriptor v1',
      'The descriptor is inside the authenticated ciphertext and is followed by the exact original bytes.',
    ),
  };
}
