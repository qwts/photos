import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { EnvelopeKey, KeyResolver } from './envelope.js';

// Master-key + versioned-library-key lifecycle per ADR-0004 §custody/rotation
// (#68). The Electron safeStorage dependency is injected so node:test proves
// restart persistence and failure paths against a fake; src/main/index wires
// the real one.

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class KeyCustodyError extends Error {
  override readonly name = 'KeyCustodyError';
}

export interface KeyDisplay {
  /** The Inspector's "KEY #N". */
  readonly id: number;
  readonly createdAt: string;
  readonly status: 'active' | 'retired';
}

interface StoredKeyRecord extends KeyDisplay {
  /** base64(nonce | tag | ciphertext) — the 32 key bytes GCM-wrapped by the
   * master key with AAD = key id. */
  readonly wrappedKey: string;
}

export interface KeysFile {
  readonly version: 1;
  readonly keys: readonly StoredKeyRecord[];
}

const MASTER_FILE = 'master.key';
const KEYS_FILE = 'keys.json';

function wrapKey(masterKey: Buffer, keyId: number, keyBytes: Buffer): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, nonce);
  const aad = Buffer.alloc(4);
  aad.writeUInt32BE(keyId, 0);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(keyBytes), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/** Recovery import (#240) validates a candidate master against stored key
 * rows without opening the whole store. */
export function unwrapStoredKey(masterKey: Buffer, keyId: number, wrapped: string): Buffer {
  return unwrapKey(masterKey, keyId, wrapped);
}

/** Reads keys.json for out-of-store consumers (#240); null when absent or
 * unparseable. */
export function readKeysFile(dataDir: string): KeysFile | null {
  const keysPath = join(dataDir, KEYS_FILE);
  if (!existsSync(keysPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(keysPath, 'utf8')) as KeysFile;
  } catch {
    return null;
  }
}

function unwrapKey(masterKey: Buffer, keyId: number, wrapped: string): Buffer {
  const raw = Buffer.from(wrapped, 'base64');
  if (raw.length < 12 + 16) {
    throw new KeyCustodyError(`wrapped key ${String(keyId)} is malformed`);
  }
  const decipher = createDecipheriv('aes-256-gcm', masterKey, raw.subarray(0, 12));
  const aad = Buffer.alloc(4);
  aad.writeUInt32BE(keyId, 0);
  decipher.setAAD(aad);
  decipher.setAuthTag(raw.subarray(12, 28));
  try {
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  } catch {
    throw new KeyCustodyError(`wrapped key ${String(keyId)} failed authentication (wrong master key or tampered store)`);
  }
}

/** Atomic-ish write: temp file + rename, same volume by construction. */
function writeFileAtomic(path: string, data: string | Buffer): void {
  const temp = `${path}.tmp`;
  writeFileSync(temp, data);
  renameSync(temp, path);
}

export interface KeyStoreOptions {
  readonly safeStorage: SafeStorageLike;
  /** Library data directory (ADR-0005 layout); created if missing. */
  readonly dataDir: string;
  /** Injected for tests; defaults to wall clock. */
  readonly now?: () => Date;
}

export class KeyStore {
  private constructor(
    private readonly options: KeyStoreOptions,
    private readonly masterKey: Buffer,
    private records: readonly StoredKeyRecord[],
    private keys: Map<number, Buffer>,
  ) {}

  /** First run generates the master key + KEY #1; later runs load + unwrap. */
  static open(options: KeyStoreOptions): KeyStore {
    if (!options.safeStorage.isEncryptionAvailable()) {
      throw new KeyCustodyError('OS keychain is unavailable; refusing to store the master key without it (no plaintext fallback)');
    }
    mkdirSync(options.dataDir, { recursive: true });
    const masterPath = join(options.dataDir, MASTER_FILE);
    const isFirstRun = !existsSync(masterPath);
    let masterKey: Buffer;
    if (!isFirstRun) {
      let decoded: string;
      try {
        decoded = options.safeStorage.decryptString(readFileSync(masterPath));
      } catch {
        throw new KeyCustodyError('the stored master key could not be unwrapped by the OS keychain');
      }
      masterKey = Buffer.from(decoded, 'base64');
      if (masterKey.length !== 32) {
        throw new KeyCustodyError('the stored master key is malformed');
      }
    } else {
      masterKey = randomBytes(32);
      writeFileAtomic(masterPath, options.safeStorage.encryptString(masterKey.toString('base64')));
    }

    const keysPath = join(options.dataDir, KEYS_FILE);
    let records: readonly StoredKeyRecord[];
    if (existsSync(keysPath)) {
      const parsed = JSON.parse(readFileSync(keysPath, 'utf8')) as KeysFile;
      records = parsed.keys;
    } else {
      records = [];
    }

    // An existing master key with no library keys means the keys file was
    // lost or emptied. Regenerating KEY #1 here would mint DIFFERENT bytes
    // under an id existing envelopes already reference — refuse instead
    // (PR #148 review).
    if (!isFirstRun && records.length === 0) {
      throw new KeyCustodyError(
        'the master key exists but no library keys were found; refusing to regenerate KEY #1 over an existing store (keys.json lost or corrupted)',
      );
    }
    const store = new KeyStore(options, masterKey, records, new Map());
    for (const record of records) {
      store.keys.set(record.id, unwrapKey(masterKey, record.id, record.wrappedKey));
    }
    if (isFirstRun) {
      store.createKey();
    }
    return store;
  }

  private persist(): void {
    const file: KeysFile = { version: 1, keys: this.records };
    writeFileAtomic(join(this.options.dataDir, KEYS_FILE), JSON.stringify(file, null, 2));
  }

  private createKey(): EnvelopeKey {
    const id = this.records.reduce((max, record) => Math.max(max, record.id), 0) + 1;
    const keyBytes = randomBytes(32);
    const createdAt = (this.options.now?.() ?? new Date()).toISOString();
    const record: StoredKeyRecord = {
      id,
      createdAt,
      status: 'active',
      wrappedKey: wrapKey(this.masterKey, id, keyBytes),
    };
    this.records = [
      ...this.records.map((existing) => (existing.status === 'active' ? { ...existing, status: 'retired' as const } : existing)),
      record,
    ];
    this.keys.set(id, keyBytes);
    this.persist();
    return { id, key: keyBytes };
  }

  /** The write key — the newest active key (ADR-0004 rotation model). */
  currentKey(): EnvelopeKey {
    const active = this.records.find((record) => record.status === 'active');
    if (active === undefined) {
      throw new KeyCustodyError('key store has no active key');
    }
    const key = this.keys.get(active.id);
    if (key === undefined) {
      throw new KeyCustodyError(`active key ${String(active.id)} is not unwrapped`);
    }
    return { id: active.id, key };
  }

  /** Resolver for decrypt streams — retired keys keep decrypting. */
  resolver(): KeyResolver {
    return (keyId) => this.keys.get(keyId);
  }

  /** Rotation scaffold: new writes pick up KEY #N+1; no re-encrypt sweep (ADR-0004 v1). */
  rotate(): EnvelopeKey {
    return this.createKey();
  }

  /** Metadata for the Inspector's "KEY #N" row and future key management. */
  listKeys(): readonly KeyDisplay[] {
    return this.records.map(({ id, createdAt, status }) => ({ id, createdAt, status }));
  }

  /** Recovery backup material (#240): a copy of the master key for sealing
   * into the password-encrypted recovery file. Handle and drop promptly. */
  masterKeyBytes(): Buffer {
    return Buffer.from(this.masterKey);
  }
}
