import { randomBytes } from 'node:crypto';

// ULID generation (#87): photo ids are case-sensitive ULIDs (the protocol
// URL contracts rely on that shape). 48-bit millisecond timestamp + 80 bits
// of randomness, Crockford base32 — lexicographic order follows creation
// time, no dependency needed.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(timeMs = Date.now()): string {
  let time = timeMs;
  const chars = new Array<string>(26);
  for (let index = 9; index >= 0; index -= 1) {
    chars[index] = CROCKFORD[time % 32] ?? '0';
    time = Math.floor(time / 32);
  }
  const random = randomBytes(16);
  for (let index = 0; index < 16; index += 1) {
    chars[10 + index] = CROCKFORD[(random[index] ?? 0) % 32] ?? '0';
  }
  return chars.join('');
}
