import { randomBytes, scrypt } from 'node:crypto';

import { strengthOf } from '../../shared/crypto/password-strength.js';

export const PASSWORD_KDF_V1 = {
  name: 'scrypt',
  N: 2 ** 17,
  r: 8,
  p: 1,
  saltBytes: 16,
  keyBytes: 32,
  maxmem: 160 * 1024 * 1024,
} as const;

export function assertStrongPassword(password: string): void {
  if (password.length < 8 || password.length > 1024) throw new Error('password length is invalid');
  if (strengthOf(password).score < 3) throw new Error('password is too weak');
}

export function createPasswordSaltV1(): Buffer {
  return randomBytes(PASSWORD_KDF_V1.saltBytes);
}

export function derivePasswordKeyV1(password: string, salt: Buffer): Promise<Buffer> {
  if (salt.length !== PASSWORD_KDF_V1.saltBytes) throw new Error('password salt is invalid');
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      PASSWORD_KDF_V1.keyBytes,
      {
        N: PASSWORD_KDF_V1.N,
        r: PASSWORD_KDF_V1.r,
        p: PASSWORD_KDF_V1.p,
        maxmem: PASSWORD_KDF_V1.maxmem,
      },
      (error, key) => {
        if (error !== null) reject(error);
        else resolve(key);
      },
    );
  });
}
