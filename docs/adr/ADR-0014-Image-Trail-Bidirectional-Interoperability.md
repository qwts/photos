# ADR-0014: Image Trail Bidirectional Interoperability

## Status

Accepted 2026-07-16 on [#283](https://github.com/qwts/photos/issues/283),
[#331](https://github.com/qwts/photos/issues/331), and
[#332](https://github.com/qwts/photos/issues/332), paired with
[Image Trail #560](https://github.com/qwts/image-trail/issues/560). This ADR
supersedes only the deferred import-only interoperability stance in
[ADR-0007](./ADR-0007-Backup-Format-And-Offload.md); ADR-0007's backup format,
remote layout, verification, and offload decisions remain unchanged.

## Context

Overlook and Image Trail need intentional Move and Sync workflows without
sharing native database formats, weakening either product's encryption model,
or letting a cloud provider become a plaintext exchange. The products have
different local records and key hierarchies, so direct database access and
reuse of either product's backup format would couple migrations and custody.

Move also needs a crash-safe point at which the source may delete data. Sync
needs stable cross-product identity, deterministic field-level conflict
detection, and reviewed deletion semantics. pCloud is the first common
transport, while Google Drive and iCloud must fit the same protocol without
becoming alternate formats.

## Decision

### Contract ownership and compatibility

Overlook owns the canonical, forward-versioned interoperability contract under
`design/handoff/contracts/v1/`. It publishes strict runtime schemas,
Draft 2020-12 JSON schemas, golden fixtures, and `SHA256SUMS`. Image Trail
adopts those artifacts exactly and tests the published checksum; neither
product maintains a semantically similar fork.

The v1 envelope covers manifests, records, albums, encrypted blob references,
acknowledgements, resumable journals, and errors. Unsupported contract or
pairing versions fail closed. Every message has a random message id, transfer
id, pairing id, source and target product, operation, kind, timestamp, and
monotonic sequence. `(pairingId, messageId)` is the replay identity.

### Pairing and provider custody

Pairing generates a random 256-bit interoperability key. A user-supplied
pairing password derives a separate wrapping key with PBKDF2-SHA-256, a fresh
16-byte salt, and 600,000 iterations. AES-256-GCM seals the interoperability
key; a domain-separated AAD value authenticates the complete pairing header.
The password and plaintext key never enter provider files, renderer state,
logs, or persistent temporary files. Main/background-process custody keeps
released key bytes in memory only and zeroizes replaceable copies.

Provider storage contains only the password-protected pairing bundle and
interop-key-encrypted inbox, outbox, acknowledgement, and journal objects. It
never contains plaintext records, thumbnails, originals, credentials, or
interop keys.

### Identity, translation, and revisions

Each logical record and album gets a stable random interoperability id plus its
origin product/local id. SHA-256 hashes identify content; file names never do.
Records carry a two-actor revision vector and per-field vectors. Unknown
product-specific metadata stays in namespaced round-trip fields so a trip
through the sibling product does not silently erase it.

Each product translates between this canonical record and its native model at
its own persistence boundary. The protocol does not expose or clone either
native database. Concurrent vectors create an explicit reviewed conflict with
`keep-image-trail`, `keep-overlook`, or `keep-both`; neither last-write-wins nor
filename matching is allowed. Deletes are tombstones and propagate only after
review.

#### Overlook translation and compatibility custody

Overlook persists canonical records and albums in dedicated SQLCipher-backed
interop tables. A web bookmark without a transported and verified original is
not inserted into the native `photos` table. Its origin, stable interop id,
revision vectors, URL, dimensions, bookmark/capture/download timestamps,
source compatibility, remote blob references, and namespaced unknown metadata
remain first-class interop data. Bookmark time is never promoted to capture or
EXIF time, and camera, lens, exposure, GPS, and place fields are never
fabricated.

The main process owns legacy Image Trail compatibility import. Plain bookmark
exports and password-encrypted bookmark/full-backup exports are parsed per row.
Encrypted compatibility retains Image Trail's PBKDF2-SHA-256 600,000-iteration
and AES-256-GCM parameters; malformed headers, wrong passwords, and corrupt
ciphertext share one failure surface. Passwords and decrypted bytes do not
enter renderer state, logs, or persistent temporary files, and replaceable
byte buffers are cleared after use.

Legacy stored-original and inline-thumbnail references remain
`metadata-only`/`unavailable` until the blob transport proves bytes, content
hash, and key custody. A reference alone never makes an original `available`.
Canonical available originals must have a content hash equal to record
identity before persistence. Content hashes, not filenames, drive duplicate
review; a divergent interop id for the same remote origin is held as an
unpersisted conflict for explicit policy resolution.

### Move, Sync, and durability

Every operation is journaled and restartable. The sender writes encrypted
outbox records; the receiver validates, decrypts, translates, persists, and
verifies the native record and required original before emitting an encrypted
durability acknowledgement.

Move may delete a source record or blob only after the target acknowledgement
proves the corresponding metadata and required original are durable. Partial,
offline, quota, auth, corruption, wrong-key, and interruption failures retain
the source and resume from the journal. Cancellation never implies deletion.

Sync exchanges revision summaries first, classifies eligible, duplicate,
conflict, metadata-only, unsupported, and skipped records, and presents counts
before transfer. Acknowledged field revisions merge component-wise. Reviewed
conflict and delete decisions are journaled so retries are idempotent.

#### Durable Move state machine

The Overlook implementation persists five independently recoverable boundaries
inside SQLCipher: transfer journals, per-record state, encrypted-message outbox
metadata, replay receipts, and append-only audit events. Counts are derived from
the durable item rows rather than incremented when messages arrive, so replay
cannot inflate eligible, duplicate, skipped, failed, acknowledged, or finalized
totals.

A target receipt is idempotent by pairing id and message id. An accepted
acknowledgement requires durable canonical metadata. Records that claim an
available original additionally require target-side content verification before
the acknowledgement can say `verified`. Metadata-only and unavailable records
retain those exact states; they never borrow a verified-original claim.

The source records an accepted acknowledgement before entering finalization.
Finalization receives either `remove-after-verified-copy` or
`preserve-original`; the former is impossible unless the source record claimed
an available original and the target acknowledgement proved it. A crash or
failure after finalization starts leaves the acknowledged item resumable, and
the source finalizer must be idempotent. Retryable target verification failures
supersede their earlier rejection with a fresh acknowledgement while retaining
the audit history. Cancellation and rejected acknowledgements never enter
source finalization.

### Transports

Transport adapters implement the same encrypted-object operations and honest
capability descriptors:

- pCloud is first and uses a dedicated interoperability root, never Image
  Trail's backup folder or Overlook's library-backup root.
- Google Drive uses its native provider adapter; Image Trail obtains extension
  OAuth through `chrome.identity`.
- iCloud Drive is exposed to Image Trail through a signed Overlook native
  messaging host with the required Apple ubiquity-container entitlement. The
  host transports only protocol ciphertext and reports capability/errors; it
  does not expose Overlook's database or keys.

No adapter may weaken verification or custody. Provider-specific limitations
surface through shared status/error vocabulary instead of format branches.

## Consequences

- Contract and pairing ship before translation, Move, Sync, transport, or UI
  implementations; both repositories gate exact artifact parity.
- The products remain independently migratable, at the cost of explicit
  translation and preservation maps at both boundaries.
- Move consumes extra storage until the durability acknowledgement completes;
  this is required to make deletion safe.
- Sync conflicts and deletes require user review rather than a simpler but
  destructive last-write-wins rule.
- iCloud interoperability requires a signed/notarized native host and Apple
  entitlement; it cannot be implemented as browser-only filesystem access.
- Cross-product acceptance tests must cover valid, invalid, corrupt, replay,
  unsupported-version, round-trip, interruption, duplicate, conflict, and
  deletion cases for every supported transport.
- The canonical checksum includes the executable cross-repository evidence map.
  Normal CI validates automated references; epic closure additionally requires
  every owner-run entry in the [Interop Closeout Evidence](../Interop-Closeout-Evidence.md)
  runbook to be verified with a timestamped GitHub result.
