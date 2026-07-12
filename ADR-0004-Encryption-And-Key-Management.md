# ADR-0004: Encryption & Key Management

## Status

Proposed (awaiting owner ratification — issue
[#65](https://github.com/qwts/photos/issues/65))

## Context

Overlook stores originals "encrypted with your key" and the design surfaces
`AES-256 · GCM · KEY #2` in the Inspector — encryption at rest is a product
invariant that "cannot be disabled", not a feature flag. Every M03 crypto
sub-issue needs a recorded scheme to cite instead of re-deciding: cipher and
envelope, key hierarchy, custody, recovery, and whether the database itself is
encrypted. The design handoff's sibling product (Image Trail) uses
password-wrapped PBKDF2 → AES-GCM envelopes; Overlook is a desktop app with an
OS keychain available, so its custody model can be stronger than a password.

## Decision

**Blob encryption — AES-256-GCM streaming envelopes.** Originals and derived
images are encrypted in 4 MiB chunks. Each chunk is sealed with AES-256-GCM;
the nonce is a random 64-bit per-blob prefix + 32-bit chunk counter (nonce
reuse impossible within a key's lifetime at our volumes). AAD binds each chunk
to `photo id + key id + chunk index`, and the final chunk carries a
total-chunk-count marker so truncation is detectable. Integrity: the GCM tag
per chunk, plus the SHA-256 content hash of the plaintext original stored in
the database (also the blob-store address, ADR-0005).

**Key hierarchy — master key → versioned library keys.**

- A random 256-bit **master key** exists once per library. It never touches
  the database; it only wraps other keys.
- Versioned 256-bit **library keys** (`KEY #1`, `KEY #2`, … — the ids the
  Inspector shows) are stored in the `keys` table wrapped by the master key.
  Blobs record the key id that sealed them.
- **Rotation (v1):** creating a new library key makes it the write key — new
  imports and re-encrypts use it. Existing blobs stay on their original key
  and are **not** lazily re-encrypted in v1; rotation limits future exposure,
  it does not retroactively re-seal history. Recorded plainly so the Inspector
  copy stays honest.

**Master-key custody — OS keychain via Electron `safeStorage`, with a
required recovery phrase.**

- The master key is wrapped by `safeStorage` (Keychain on macOS, DPAPI on
  Windows, secret service on Linux) and stored in the library directory.
- **Linux caveat:** when no secret service is available `safeStorage` falls
  back to weak obfuscation. Overlook detects this
  (`safeStorage.isEncryptionAvailable()`), warns explicitly, and refuses to
  describe the library as keychain-protected — factual security copy, never
  marketing.
- **Recovery (v1): a recovery phrase is generated at library creation** —
  BIP39-style words encoding the master key — shown once with instructions to
  store it offline. This is not optional polish: restoring a pCloud backup on
  a new machine has no OS keychain to read, so a portable key path must exist
  for backup to mean anything. Stated plainly in-product: *"Lose the keychain
  and the phrase, and the library cannot be decrypted. There is no other
  recovery."*

**Database at rest — whole-DB encryption (SQLCipher family).** Filenames,
EXIF, GPS coordinates, and places are exactly as sensitive as pixels; a
plaintext catalog next to encrypted blobs leaks most of what matters.
Field-level encryption would destroy indexing and querying (no index over an
encrypted `place`). The database is SQLCipher-encrypted
(`better-sqlite3-multiple-ciphers` or equivalent — final module choice rides
ADR-0006's native-module policy), keyed by a DB key wrapped by the master key.

**Threat model (v1), stated per the security-copy voice:**

- **Protects against:** device theft / disk imaging (everything at rest is
  ciphertext); the backup provider (pCloud holds only client-side-encrypted
  bytes); other OS users without the keychain session.
- **Does not protect against:** a compromised OS or session (keys are in
  process memory while the app runs); an attacker with the recovery phrase;
  traffic/size analysis by the backup provider (blob count and sizes are
  visible).

## Consequences

- M03 sub-issues implement against named sections here (envelope, `keys`
  table, custody, recovery) instead of debating scheme choices in PRs.
- The recovery-phrase flow becomes a hard requirement of library creation
  (M03) and of backup restore (M08) — UI copy for it must follow the design
  system's factual security voice.
- SQLCipher pulls the database driver into ADR-0006's native-module policy
  (prebuilds, Electron ABI, exact pins); if that policy rules the SQLCipher
  variant out, this ADR must be revisited **before** M03 starts, not worked
  around silently.
- Chunked GCM means streaming import/export without whole-file buffering, at
  the cost of a small per-chunk overhead (16-byte tag per 4 MiB).
- Lazy re-encryption after rotation is explicitly deferred; if it becomes a
  requirement, it arrives as a new ADR amending the rotation section.
