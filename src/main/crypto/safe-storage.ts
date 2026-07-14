import type { SafeStorageLike } from './keystore.js';

// safeStorage selection, extracted from the composition root. The insecure
// keystore (OVERLOOK_INSECURE_KEYSTORE=1, unpackaged only — ADR-0004's
// stance stands for production) is obfuscation-only for environments
// without a real keychain (CI Linux) and logs loudly.

function devInsecureKeystore(): SafeStorageLike {
  const pad = 0x5f;
  console.warn('[overlook] OVERLOOK_INSECURE_KEYSTORE active — dev/test profile only, no real key protection');
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(Buffer.from(plain, 'utf8').map((byte) => byte ^ pad)),
    decryptString: (encrypted) => Buffer.from(encrypted.map((byte) => byte ^ pad)).toString('utf8'),
  };
}

export function pickSafeStorageImpl(real: SafeStorageLike, isPackaged: boolean): SafeStorageLike {
  if (process.env['OVERLOOK_INSECURE_KEYSTORE'] === '1' && !isPackaged) {
    return devInsecureKeystore();
  }
  return real;
}
