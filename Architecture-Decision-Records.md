# Architecture Decision Records

Canonical architecture decision records for photos. ADRs live **only** in this
wiki (no repo copies). They are appended, never rewritten — a superseding
decision gets a new ADR that links back to the one it replaces.

## Index

| ADR                                                                  | Title                        | Status   |
| -------------------------------------------------------------------- | ---------------------------- | -------- |
| [ADR-0001](ADR-0001-Automation-Check-Governance)                     | Automation Check Governance  | Accepted |
| [ADR-0002](ADR-0002-Versioning-Policy)                               | Versioning Policy            | Accepted |
| [ADR-0003](ADR-0003-Desktop-Stack)                                   | Desktop Stack                | Accepted |
| [ADR-0004](ADR-0004-Encryption-And-Key-Management)                   | Encryption & Key Management  | Accepted |
| [ADR-0005](ADR-0005-Library-Data-Model)                              | Library Data Model           | Accepted |
| [ADR-0006](ADR-0006-Media-Processing)                                | Media Processing             | Accepted |
| [ADR-0007](ADR-0007-Backup-Format-And-Offload)                       | Backup Format & Offload      | Accepted |
| [ADR-0008](ADR-0008-Recovery-Key-Format)                             | Recovery-Key Format & KDF    | Accepted |
| [ADR-0009](ADR-0009-Cloud-Recovery-Bootstrap-And-Manifest-V2)        | Cloud Recovery Bootstrap     | Accepted |
| [ADR-0010](ADR-0010-Cloud-Restore-Staging-And-Atomic-Activation)     | Cloud Restore Activation     | Accepted |
| [ADR-0011](ADR-0011-Provider-Catalog-Capabilities-And-Switching)     | Provider Catalog & Switching | Accepted |
| [ADR-0012](ADR-0012-Continuous-Backup-Integrity-And-Recovery-Repair) | Continuous Backup Integrity  | Accepted |
| [ADR-0013](ADR-0013-App-Lock-Key-Release-And-Protected-Albums)       | App Lock & Protected Albums  | Accepted |
| [ADR-0014](ADR-0014-Image-Trail-Bidirectional-Interoperability)      | Image Trail Interoperability | Accepted |
| [ADR-0015](ADR-0015-Deterministic-Reviewed-Sync-Journals)            | Deterministic Sync Journals  | Accepted |
| [ADR-0016](ADR-0016-Isolated-Encrypted-Interop-Transports)           | Isolated Interop Transports  | Accepted |

## Template

New ADRs use the next sequential number and this structure:

```markdown
# ADR-NNNN: Title

## Status

Proposed | Accepted | Superseded by [ADR-MMMM](ADR-MMMM-Title)

## Context

What forces are at play; why a decision is needed now.

## Decision

The decision, stated actively ("We will …").

## Consequences

What becomes easier, what becomes harder, what must be revisited and when.
```

Add the new ADR to the index table above and link it from any affected pages.
