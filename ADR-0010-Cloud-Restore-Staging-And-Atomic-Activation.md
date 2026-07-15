# ADR-0010: Cloud Restore Staging and Atomic Activation

## Status

Accepted (2026-07-14 with merged
[#288](https://github.com/qwts/photos/issues/288) and
[PR #294](https://github.com/qwts/photos/pull/294)). This ADR implements the
restore work deferred by
[ADR-0009](ADR-0009-Cloud-Recovery-Bootstrap-And-Manifest-V2).

## Context

ADR-0009 makes a cloud backup self-describing and breaks the fresh-machine
key-bootstrap cycle, but authenticated remote bytes are not yet a safe local
library. Restore must tolerate a corrupt newest generation, interruption,
offline/auth failures, insufficient disk, and a crash during replacement
without exposing a half-restored catalog or destroying an existing library.

The local data directory combines key custody, a SQLCipher database,
authenticated original envelopes, and authenticated derived thumbnails.
Activating any subset would violate the product's encrypted-at-rest and
catalog/blob consistency invariants.

## Decision

**Restore remains provider-neutral.** The engine uses only `StorageProvider`
operations. It authenticates `recovery/bootstrap.ovrb` with the recovered
master, resolves every wrapped library key, then opens retained manifests in
descending generation order. A generation is eligible only when its envelope,
strict schema, library ID, database compatibility, key references, and unique
blob references validate. Corrupt or unsupported candidates may fall back to
the retained previous generation. Auth, offline, cancellation, and local
resource failures do not silently select older state.

**All work lands in a sibling staging library.** For target `library/`, restore
uses `library.restore-staging/` and records a strict, atomic JSON checkpoint
bound to library ID, manifest path, and sealed-manifest SHA-256. Completed
original and thumbnail IDs are checkpointed only after authentication.
Resumption re-verifies every staged envelope before skipping a download or
derivation; a stale or candidate-mismatched checkpoint resets the staging
directory.

**Preflight precedes referenced-blob downloads.** The provider must be
connected, every manifest blob path must exist in the remote listing, and
available local capacity must cover incomplete ciphertext plus scratch space.
Failures map to stable restore reasons: authentication, offline, disk space,
corruption, wrong key, unsupported format, missing destructive authorization,
cancellation, or local I/O.

**The staged library is complete before activation.** Original envelopes are
downloaded as ciphertext and accepted only after full GCM authentication and
plaintext content-hash verification. Thumbnails are regenerated from verified
plaintext in memory and stored through the normal encrypted blob path. The
engine writes the authenticated wrapped-key set, installs the recovered master
through OS `safeStorage`, opens a fresh SQLCipher catalog with KEY #1, and
transactionally rebuilds photos, clean/synced ledger rows, FTS triggers,
albums, and ordered membership. It then compares the rebuilt catalog snapshot
to the selected manifest and re-verifies every original.

**Activation is rename-based and rollback-safe.** A non-empty target is
refused unless the caller passes explicit destructive authorization. On the
same filesystem, the target is renamed to `library.restore-previous`, the
complete staging directory is renamed to the target, and the previous copy is
removed only after the second rename succeeds. If activation fails, the
previous target is renamed back before the error surfaces. Startup recovery
restores a stranded previous directory when no target exists, or removes it
when a complete target already exists.

No plaintext original or thumbnail is written to disk. The provider continues
to see only already-encrypted envelopes and authenticated metadata objects.

## Consequences

- Fresh-machine reconstruction requires only provider access plus the opened
  recovery key; no old database or `keys.json` is copied.
- Checkpoints can consume staging disk until the user resumes or a later
  cleanup policy removes them; cancellation deliberately preserves verified
  work.
- Falling back can recover from a corrupt newest manifest or generation-only
  blob set, but never disguises authentication, connectivity, or local-resource
  failures.
- Fresh-profile onboarding and Settings expose the same provider-neutral
  discovery/run/cancel workflow, with an explicit destructive confirmation for
  replacement. Provider credentials and the development mock remote live at
  profile scope so atomic library replacement cannot delete the authority or
  remote bytes needed to finish restore. This is delivered by
  [#290](https://github.com/qwts/photos/issues/290); the live pCloud
  disaster-recovery contract remains
  [#291](https://github.com/qwts/photos/issues/291).

## Verification

- `tests/backup/restore-discovery.test.ts`: retained-generation fallback,
  wrong master, and duplicate-blob rejection.
- `tests/backup/restore-engine.test.ts`: complete fresh restore, corrupt-blob
  fallback, cancellation/resume without redownload, destructive authorization,
  disk preflight, provider error mapping, key/catalog/FTS/album/original/thumb
  reconstruction, and replacement cleanup.
- `tests/backup/restore-staging.test.ts`: injected activation failure restores
  the previous library and preserves staging for retry.
- `tests/backup/restore-coordinator.test.ts`: opaque recovery-key sessions,
  validated discovery summaries, wrong-password isolation, and cancellable
  resumable runs.
- `tests/e2e/restore-cloud.spec.ts`: cross-profile backup, wrong-password
  non-destruction, cancellation, resume, atomic activation, relaunch, and
  restored photo count.
