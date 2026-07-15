import type { EnvelopeKey } from '../crypto/envelope.js';
import { createEncryptStream } from '../crypto/envelope.js';

/** Seals manifest JSON as one encrypted envelope for provider upload. */
export async function sealManifestJson(json: string, key: EnvelopeKey): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const encrypt = createEncryptStream(key, { photoId: 'manifest' });
  encrypt.on('data', (chunk: Buffer) => chunks.push(chunk));
  await new Promise<void>((resolve, reject) => {
    encrypt.on('end', resolve);
    encrypt.on('error', reject);
    encrypt.end(Buffer.from(json));
  });
  return Buffer.concat(chunks);
}
