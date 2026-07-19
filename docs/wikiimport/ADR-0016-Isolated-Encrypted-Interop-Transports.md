# ADR-0016: Isolated Encrypted Interop Transports

## Status

Accepted — 2026-07-16

Implementation: [#335](https://github.com/qwts/photos/issues/335)

Companion: [qwts/image-trail#588](https://github.com/qwts/image-trail/issues/588)

Supplies the transport boundary defined by
[ADR-0014](ADR-0014-Image-Trail-Bidirectional-Interoperability).

## Context

Overlook's pCloud and Google Drive providers intentionally own backup roots,
library discovery, and sealed backup credentials. Interop must reuse their
verified provider mechanics without granting access to backup discovery or
paths. iCloud additionally requires a signed native boundary because a browser
extension cannot enter the app's ubiquity container directly.

## Decision

Encrypted interop files use immutable chunks no larger than 4 MiB. Checksum
verification determines resume state; a manifest binds pairing, transfer, path,
size, chunk hashes, and whole-file SHA-256. Typed errors preserve auth, quota,
not-found, corrupt, unavailable, offline, and partial retry semantics.

pCloud and Google Drive provider constructors accept explicit namespace
identities. Backup defaults remain `/Overlook` and `qwts-photos`; interop
factories use `Overlook Interop/v1` and `qwts-overlook-interop-v1`. The narrowed
interop object-store interface does not expose library discovery. Drive keeps
resumable upload, pagination, checksum fallback, and reconnect behavior.

The native iCloud host manifest allows only the released Image Trail extension
origin. Its dispatcher requires macOS, valid signature, the iCloud entitlement,
available account custody, exact extension identity, traversal-free paths, and
control frames no larger than 64 KiB. Frames reject embedded bytes and
ciphertext; put/materialize operations exchange opaque encrypted file
references. Provider account change, conflict, quota, and unavailable results
fail closed through the shared vocabulary.

## Consequences

- Backup provider behavior and roots remain unchanged.
- Interop cannot enumerate backup libraries through its narrowed authority.
- Resume is based on remote verification rather than transient counters.
- Signing, notarization, entitlement, and released-extension identity remain
  packaging requirements; no unsigned or browser-only fallback exists.

## Evidence

- `tests/interop/transport.test.ts`
- `tests/backup/pcloud-provider.test.ts`
- `tests/backup/google-drive-provider.test.ts`
- [Provider-neutral transport acceptance](Acceptance-Test-Provider-Neutral-Interop-Transports)
