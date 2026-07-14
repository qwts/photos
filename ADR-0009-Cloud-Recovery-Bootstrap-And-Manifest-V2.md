# ADR-0009: Cloud Recovery Bootstrap and Backup Manifest v2

## Status

Accepted (2026-07-14 via merged
[PR #292](https://github.com/qwts/photos/pull/292), closing
[#289](https://github.com/qwts/photos/issues/289)). This ADR extends
[ADR-0007](ADR-0007-Backup-Format-And-Offload) and
[ADR-0008](ADR-0008-Recovery-Key-Format); it does not replace their blob,
offload, or recovery-file formats.

## Context

ADR-0007 requires an encrypted, generation-numbered manifest that can rebuild
a library without the local database. The schema-1 implementation contains
only photo ID, content hash, byte size, file name, and key ID. It cannot
reconstruct library identity, complete display metadata, favorites, albums,
ordered membership, or database/schema compatibility.

There is also a key-bootstrap cycle. Manifest envelopes are sealed by the
active versioned library key. The password-encrypted recovery file from
ADR-0008 contains the master key, while the master-wrapped library-key records
live only in local `keys.json`. On a lost machine, the user has the key needed
to unwrap those records but not the records needed to resolve the manifest's
envelope key ID.

## Decision

**Remote layout gains one provider-neutral recovery object:**

```text
/Overlook/<library-id>/
  recovery/bootstrap.ovrb
  manifest/gen-<n>.ovlk
  blobs/<h2>/<hash>
```

The backup engine uploads and checksum-verifies
`recovery/bootstrap.ovrb` before publishing a manifest generation. Replacing
the bootstrap first is safe because its wrapped-key set is a rotation
superset: an interrupted run may leave an older manifest with newer wrapped
keys, never a newer manifest whose envelope key is unavailable. Manifest
generations retain ADR-0007's newest-two policy. Bootstrap and manifest bytes
must both pass provider checksum/size verification before the run reports the
manifest complete.

**Recovery-bootstrap format is `OVRB` version 1.** The binary framing is:

```text
magic "OVRB" (4) | version 0x01 (1) | nonce (12)
| AES-256-GCM ciphertext(JSON payload) | tag (16)
```

The encryption key is
`HKDF-SHA256(master, info="overlook cloud recovery bootstrap v1")`. The
header is GCM AAD. The authenticated JSON payload contains schema version,
library ULID, generation timestamp, and every versioned `keys.json` record:
key ID, creation time, active/retired state, and the data key already wrapped
by the master. Exactly one record is active and key IDs are unique. The outer
document is capped at 1 MiB. Neither the raw master key nor any unwrapped data
key is uploaded. The temporary in-memory master-key copy used to seal the
bootstrap is wiped after use.

**Manifest schema 2 is a strict, self-consistent snapshot.** It contains:

- schema version, library ULID, local database schema version, and generation
  timestamp;
- sorted key IDs in use and aggregate photo/byte/album totals;
- every recoverable photo's ID, original file properties, complete display
  metadata, favorite/deleted state, key ID, content hash, and canonical
  `blobs/<h2>/<hash>` reference;
- albums in stable position order with ordered photo membership.

The repository reads photos, albums, membership, key IDs, and totals in one
SQLite transaction. Live photos are included. Soft-deleted photos are included
only when their ledger state proves the original is already remote (`synced`
or `offloaded`); a local-only deleted original is not promised by a cloud
manifest. Album membership is restricted to included photos. Validators reject
unknown fields, malformed timestamps/hashes, duplicate IDs/positions/members,
missing key references, non-canonical blob paths, unknown album members, and
incorrect totals before upload or restore.

**Schema 1 remains readable but is not disaster-recoverable.** Parsers return
it as a typed legacy document with `restorable: false`. Existing schema-1
backups retain their supported backup/offload behavior; restore UI must not
claim they can reconstruct a complete library.

**Fresh-machine key resolution is explicit.** After the user opens
`overlook-recovery.key`, the recovered master decrypts the bootstrap and
authenticates/unwraps every library-key record. That resolver then opens the
retained manifest and referenced blob envelopes. Wrong masters, tampering,
malformed records, missing keys, and unsupported versions fail closed before
any local library is activated.

## Consequences

- A provider-neutral restore engine can discover compatibility and rebuild
  complete metadata without copying the old database or `keys.json`.
- Cloud recovery still requires two separately held authorities: provider
  credentials for ciphertext and the password-protected recovery file for the
  master key.
- The small bootstrap is rewritten and verified with each manifest generation;
  this adds one provider object operation but removes the key-resolution cycle.
- Retained manifests are forward-only versioned documents. A future schema
  adds a parser/migration path rather than weakening strict schema-2 checks.
- Full staging, blob download, atomic activation, cancellation/resume, and UI
  remain owned by [#288](https://github.com/qwts/photos/issues/288) and
  [#290](https://github.com/qwts/photos/issues/290). The end-to-end/live
  disaster-recovery contract remains
  [#291](https://github.com/qwts/photos/issues/291).

## Verification

- `tests/backup/backup-manifest.test.ts`: schema-1 classification; schema-2
  round trip and cross-record/path/time/order validation.
- `tests/backup/recovery-bootstrap.test.ts`: fresh-process key resolution;
  wrong master, tamper, malformed key sets/framing, and temporary-key wiping.
- `tests/backup/manifest-snapshot.test.ts`: transactional full-state snapshot,
  backed-up deleted state, local-only deleted exclusion, ordering, and empty
  library.
- `tests/backup/backup-engine.test.ts`: verified bootstrap-before-manifest
  publication and newest-two manifest retention.
