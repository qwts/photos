# Architecture Decision Records

Canonical architecture decision records for photos. ADRs live **only** in this
wiki (no repo copies). They are appended, never rewritten — a superseding
decision gets a new ADR that links back to the one it replaces.

## Index

| ADR                                                                | Title                       | Status   |
| ------------------------------------------------------------------ | --------------------------- | -------- |
| [ADR-0001](ADR-0001-Automation-Check-Governance)                    | Automation Check Governance | Accepted |
| [ADR-0002](ADR-0002-Versioning-Policy)                              | Versioning Policy           | Accepted |
| [ADR-0003](ADR-0003-Desktop-Stack)                                  | Desktop Stack               | Accepted |
| [ADR-0004](ADR-0004-Encryption-And-Key-Management)                  | Encryption & Key Management | Proposed |
| [ADR-0005](ADR-0005-Library-Data-Model)                             | Library Data Model          | Proposed |
| [ADR-0006](ADR-0006-Media-Processing)                               | Media Processing            | Proposed |

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
