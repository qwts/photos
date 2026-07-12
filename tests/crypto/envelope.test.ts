import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { pipeline } from 'node:stream/promises';

import {
  createDecryptStream,
  createEncryptStream,
  EnvelopeError,
  type EnvelopeKey,
  type KeyResolver,
} from '../../src/main/crypto/envelope.js';

const KEY_1: EnvelopeKey = { id: 1, key: randomBytes(32) };
const KEY_2: EnvelopeKey = { id: 2, key: randomBytes(32) };
const RESOLVE: KeyResolver = (id) => (id === 1 ? KEY_1.key : id === 2 ? KEY_2.key : undefined);
const CONTEXT = { photoId: '01J8ULID0PHOTO' };

async function encrypt(plaintext: Buffer, key = KEY_1, chunkSize = 1024): Promise<Buffer> {
  return buffer(Readable.from([plaintext]).pipe(createEncryptStream(key, CONTEXT, { chunkSize })));
}

async function decrypt(envelope: Buffer, resolve: KeyResolver = RESOLVE, context = CONTEXT): Promise<Buffer> {
  return buffer(Readable.from([envelope]).pipe(createDecryptStream(resolve, context)));
}

describe('envelope round-trips', () => {
  test('empty plaintext', async () => {
    const envelope = await encrypt(Buffer.alloc(0));
    assert.deepEqual(await decrypt(envelope), Buffer.alloc(0));
  });

  test('small single-chunk plaintext', async () => {
    const plaintext = Buffer.from('originals stay on disk, encrypted with your key');
    assert.deepEqual(await decrypt(await encrypt(plaintext)), plaintext);
  });

  test('large multi-chunk plaintext survives arbitrary write boundaries', async () => {
    const plaintext = randomBytes(1024 * 1024 + 313);
    const envelope = await encrypt(plaintext, KEY_1, 64 * 1024);
    // Re-feed the envelope in awkward slices to exercise the buffering paths.
    const slices: Buffer[] = [];
    for (let offset = 0; offset < envelope.length; offset += 7777) {
      slices.push(envelope.subarray(offset, Math.min(offset + 7777, envelope.length)));
    }
    const roundTripped = await buffer(Readable.from(slices).pipe(createDecryptStream(RESOLVE, CONTEXT)));
    assert.deepEqual(roundTripped, plaintext);
  });

  test('exact chunk-size boundary plaintext', async () => {
    const plaintext = randomBytes(2048);
    assert.deepEqual(await decrypt(await encrypt(plaintext, KEY_1, 1024)), plaintext);
  });

  test('cross-key-version decrypt picks the right key by id', async () => {
    const plaintext = randomBytes(4096);
    const envelope = await encrypt(plaintext, KEY_2);
    assert.deepEqual(await decrypt(envelope), plaintext);
  });
});

describe('envelope failure modes', () => {
  test('a flipped ciphertext byte fails authentication', async () => {
    const envelope = await encrypt(randomBytes(4000));
    const tampered = Buffer.from(envelope);
    const index = tampered.length - 10;
    tampered[index] = (tampered[index] ?? 0) ^ 0xff;
    await assert.rejects(decrypt(tampered), (error: unknown) => {
      assert.ok(error instanceof EnvelopeError);
      assert.match(error.message, /failed authentication/);
      return true;
    });
  });

  test('a flipped header byte (key id) fails loudly', async () => {
    const envelope = await encrypt(randomBytes(64));
    const tampered = Buffer.from(envelope);
    tampered[7] = 99; // key id low byte → unknown key
    await assert.rejects(decrypt(tampered), /no key available for key id/);
  });

  test('unknown key id names the key it wanted', async () => {
    const envelope = await encrypt(randomBytes(64), KEY_2);
    await assert.rejects(
      decrypt(envelope, () => undefined),
      /no key available for key id 2/,
    );
  });

  test('wrong photo id context fails authentication', async () => {
    const envelope = await encrypt(randomBytes(64));
    await assert.rejects(decrypt(envelope, RESOLVE, { photoId: 'someone-else' }), /failed authentication/);
  });

  test('truncated envelope fails loudly', async () => {
    const envelope = await encrypt(randomBytes(5000), KEY_1, 1024);
    await assert.rejects(decrypt(envelope.subarray(0, envelope.length - 20)), /truncated envelope/);
  });

  test('dropping a whole trailing chunk is detected via the declared total', async () => {
    const plaintext = randomBytes(3 * 1024);
    const envelope = await encrypt(plaintext, KEY_1, 1024);
    // Build an envelope missing its middle chunk: header + first chunk + final chunk.
    // The final chunk's AAD-bound index no longer matches, so auth fails first.
    const headerLength = 4 + 1 + 4 + 8;
    const chunkLengthAt = (offset: number): number => envelope.readUInt32BE(offset + 5);
    const c1 = headerLength;
    const c1Len = 25 + chunkLengthAt(c1);
    const c2 = c1 + c1Len;
    const c2Len = 25 + chunkLengthAt(c2);
    const spliced = Buffer.concat([envelope.subarray(0, c2), envelope.subarray(c2 + c2Len)]);
    await assert.rejects(decrypt(spliced), /failed authentication/);
  });

  test('reordered chunks fail authentication', async () => {
    const envelope = await encrypt(randomBytes(2048), KEY_1, 1024);
    const headerLength = 17;
    const lenAt = (offset: number): number => envelope.readUInt32BE(offset + 5);
    const c1 = headerLength;
    const c1Len = 25 + lenAt(c1);
    const c2 = c1 + c1Len;
    const c2Len = 25 + lenAt(c2);
    const swapped = Buffer.concat([
      envelope.subarray(0, c1),
      envelope.subarray(c2, c2 + c2Len),
      envelope.subarray(c1, c1 + c1Len),
      envelope.subarray(c2 + c2Len),
    ]);
    await assert.rejects(decrypt(swapped), /failed authentication/);
  });

  test('bad magic and unsupported version are rejected', async () => {
    const envelope = await encrypt(randomBytes(16));
    const badMagic = Buffer.from(envelope);
    badMagic[0] = 0x58;
    await assert.rejects(decrypt(badMagic), /bad magic/);
    const badVersion = Buffer.from(envelope);
    badVersion[4] = 9;
    await assert.rejects(decrypt(badVersion), /unsupported envelope format version 9/);
  });

  test('forged oversized chunk length is rejected before buffering', async () => {
    const envelope = await encrypt(randomBytes(16));
    const forged = Buffer.from(envelope);
    forged.writeUInt32BE(0x7fffffff, 17 + 5);
    await assert.rejects(decrypt(forged), /exceeds the envelope maximum/);
  });

  test('data appended after the final chunk is rejected', async () => {
    const envelope = await encrypt(randomBytes(16));
    const extended = Buffer.concat([envelope, Buffer.alloc(30)]);
    await assert.rejects(decrypt(extended), /(data after the final chunk|truncated envelope)/);
  });

  test('a 16-byte key is refused', () => {
    assert.throws(() => createEncryptStream({ id: 1, key: randomBytes(16) }, CONTEXT), /AES-256 key must be 32 bytes/);
  });

  test('a resolver returning a wrong-length key is refused', async () => {
    const envelope = await encrypt(randomBytes(16));
    await assert.rejects(
      decrypt(envelope, () => randomBytes(16)),
      /AES-256 key must be 32 bytes/,
    );
  });

  test('a valid-tag chunk declaring the wrong total is rejected (buggy-encryptor guard)', async () => {
    // Hand-seal a single-chunk envelope whose final chunk truthfully binds
    // totalChunks=2 in its AAD (so the tag verifies) while only one chunk
    // exists — only the declared-total check can catch this.
    const { createCipheriv } = await import('node:crypto');
    const noncePrefix = randomBytes(8);
    const header = Buffer.alloc(17);
    Buffer.from('OVLK', 'ascii').copy(header, 0);
    header.writeUInt8(1, 4);
    header.writeUInt32BE(KEY_1.id, 5);
    noncePrefix.copy(header, 9);

    const nonce = Buffer.alloc(12);
    noncePrefix.copy(nonce, 0);
    nonce.writeUInt32BE(0, 8);
    const photoId = Buffer.from(CONTEXT.photoId, 'utf8');
    const fixed = Buffer.alloc(13);
    fixed.writeUInt32BE(KEY_1.id, 0);
    fixed.writeUInt32BE(0, 4);
    fixed.writeUInt8(1, 8); // final flag
    fixed.writeUInt32BE(2, 9); // lies: declares two chunks
    const cipher = createCipheriv('aes-256-gcm', KEY_1.key, nonce);
    cipher.setAAD(Buffer.concat([photoId, fixed]));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from('x')), cipher.final()]);
    const prefix = Buffer.alloc(25);
    prefix.writeUInt8(1, 0);
    prefix.writeUInt32BE(2, 1);
    prefix.writeUInt32BE(ciphertext.length, 5);
    cipher.getAuthTag().copy(prefix, 9);

    await assert.rejects(decrypt(Buffer.concat([header, prefix, ciphertext])), /final chunk declares 2 chunks but 1 arrived/);
  });

  test('a chunk size beyond the decrypt limit is refused at encrypt time', () => {
    assert.throws(() => createEncryptStream(KEY_1, CONTEXT, { chunkSize: 9 * 1024 * 1024 }), /exceeds the decryptable maximum/);
  });

  test('non-positive chunk size is refused', () => {
    assert.throws(() => createEncryptStream(KEY_1, CONTEXT, { chunkSize: 0 }), /chunkSize must be positive/);
  });
});

describe('streaming behavior', () => {
  test('output flows before input completes (bounded buffering)', async () => {
    const chunkSize = 64 * 1024;
    const totalChunks = 32;
    let firstOutputAtInputChunk = -1;
    let inputChunksFed = 0;

    const source = new Readable({
      read(): void {
        if (inputChunksFed < totalChunks) {
          inputChunksFed += 1;
          this.push(randomBytes(chunkSize));
        } else {
          this.push(null);
        }
      },
    });

    const encryptStream = createEncryptStream(KEY_1, CONTEXT, { chunkSize });
    encryptStream.on('data', () => {
      if (firstOutputAtInputChunk === -1) {
        firstOutputAtInputChunk = inputChunksFed;
      }
    });
    const devnull = new Writable({
      write(_chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        callback();
      },
    });
    await pipeline(source, encryptStream, devnull);

    assert.notEqual(firstOutputAtInputChunk, -1);
    assert.ok(
      firstOutputAtInputChunk < totalChunks / 2,
      `first output arrived at input chunk ${String(firstOutputAtInputChunk)} of ${String(totalChunks)} — encryption is buffering, not streaming`,
    );
  });
});
