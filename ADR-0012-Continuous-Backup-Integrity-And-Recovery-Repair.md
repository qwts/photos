# ADR-0012: Continuous Backup Integrity and Recovery Repair

## Status

Accepted (2026-07-15; implements
[#302](https://github.com/qwts/photos/issues/302) and extends
[ADR-0007](ADR-0007-Backup-Format-And-Offload) and
[ADR-0009](ADR-0009-Cloud-Recovery-Bootstrap-And-Manifest-V2))

## Context

Verify-after-upload proves an object was correct when it landed, but it does
not prove that the provider still retains those exact bytes later. A missing
or damaged blob, bootstrap, or newest manifest can otherwise leave the UI
green until a disaster-recovery attempt fails. Large libraries also make a
full remote walk on every launch impractical.

## Decision

Overlook will run one bounded integrity page after every otherwise-successful
backup run, including an empty manual run. The page walks stable photo ids for
rows whose ledger state is `synced` or `offloaded`; its provider-scoped cursor
is stored in the encrypted library database and resets only after a complete
cycle.

- When local ciphertext remains, Overlook compares its SHA-256 and size with
  `StorageProvider.verify`. Missing or mismatched remote bytes are replaced
  from the unchanged encrypted envelope and verified again.
- When the remote is the only original, Overlook downloads and authenticates
  the complete envelope in memory, then re-hashes plaintext against the
  content address. Missing or invalid ciphertext changes the ledger to
  `error`; it is never reported as safely backed up.
- Provider authentication and transient failures remain retryable failures,
  not corruption findings.
- The recovery bootstrap and newest advertised manifest are opened through
  the same fresh-profile discovery path used by restore. A missing or invalid
  bootstrap, or a newest generation that requires fallback, publishes a new
  bootstrap and verified manifest generation. Retained older generations are
  not destroyed before the replacement verifies.
- Repair, unrecoverable loss, and check failures append to the backup audit
  log and cross the typed completion event. Renderer updates patch sync state
  and summaries without invalidating the gallery.

The batch is 50 rows. This is deliberately small enough to keep a 1,500-photo
upload responsive while repeated successful backup opportunities eventually
cover the whole library.

## Consequences

- “Backed up” becomes a continuously re-proven claim rather than a permanent
  bit set at upload time.
- Provider switching needs independent cursors; one provider's completed walk
  says nothing about another provider.
- Remote-only loss cannot be repaired automatically. It is made explicit and
  actionable while retained metadata and audit evidence explain the gap.
- Integrity work adds bounded provider calls after successful backups. A full
  cycle takes multiple runs for large libraries by design.
- Mock-provider contracts are mandatory in CI. The pCloud form is opt-in,
  isolated under a unique library home, and cleans every object it creates.
