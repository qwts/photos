# ADR-0025: Encrypted Activity History and Capability-Aware Undo

## Status

Accepted 2026-07-20 on issue
[#613](https://github.com/qwts/photos/issues/613). Implementation is split between
[#614](https://github.com/qwts/photos/issues/614) (activity persistence and
presentation) and [#615](https://github.com/qwts/photos/issues/615) (Undo and
Redo). Neither implementation issue may weaken this contract without an ADR
amendment.

This ADR extends the encrypted-journal custody in
[ADR-0014](./ADR-0014-Image-Trail-Bidirectional-Interoperability.md) and
[ADR-0015](./ADR-0015-Deterministic-Reviewed-Sync-Journals.md), the irreversible
boundaries in
[ADR-0023](./ADR-0023-Trash-Purge-And-Destructive-Action-Ceremony.md), and the
command identity contract in
[ADR-0024](./ADR-0024-Shared-Command-Registry-And-Application-Menu.md).

## Context

Overlook persists operational state for particular jobs, but none of it is a
user activity model. The import journal is temporary crash-recovery state;
interoperability journals and audit rows explain individual transfers; Trash
is bounded content recovery. Combining those records in the renderer would
leak implementation details, produce inconsistent ordering, and let stale UI
state claim that an operation is reversible.

An event saying that an action happened is also not proof that it can be
undone. A favorite can usually be restored to its previous value, while a Move
may need to recreate a source file on a volume that is now missing, read-only,
renamed, or occupied. Permanent deletion remains irreversible even if its
ceremony is recorded perfectly.

## Decision

### 1. Activity is an append-only audit projection

The native library remains the source of truth. Activity events are an
append-only, user-facing audit projection written by trusted main-process
services after a domain operation reaches a durable boundary. They are not an
event-sourced replay log and must never be used to reconstruct library state.

Each library owns its activity records in that library's SQLCipher database.
Every event contains:

- a random, stable event ID and a transaction-assigned, monotonically
  increasing library sequence;
- an immutable event type and schema version;
- the durable occurrence time plus an optional user-request time;
- an actor class (`local-user`, `system`, `interop-peer`, or `recovery`) and a
  privacy-safe actor ID where one is required;
- a root correlation ID, optional causation event ID, and stable operation ID;
- the library ID, affected entity IDs, outcome, and a versioned minimal
  payload.

Sequence is the canonical order. Wall-clock time is display metadata only.
`(libraryId, operationId, eventType)` is the idempotency identity at a service
boundary; a retry returns the existing event, while reuse with different
content fails closed. Multi-step work emits milestone events under one root
correlation ID instead of mutating an earlier event. Corrections and redactions
are new events that supersede display of the earlier payload without erasing
the audit fact.

Event type meanings are immutable. A migration may add optional fields or
translate an old payload into a read model, but it may not reinterpret an
existing type. Unknown future types remain countable and safely display as a
generic activity item.

Activity is committed in the same SQLCipher transaction as a local domain
mutation when both use the library database. Work that crosses databases,
filesystems, or providers uses the owning durable journal and publishes its
activity milestone idempotently after that journal commits. Renderer requests,
toast callbacks, and native-menu state can request a command, but cannot forge
an event or mark an operation successful.

The first event taxonomy covers imports (including verified Move outcomes),
album membership, favorites, Trash and restore, export, and destructive
ceremonies. Fine-grained progress and routine maintenance stay in operational
journals; activity records user-meaningful durable outcomes and partial
failures.

### 2. History and Undo are separate records

An activity event records what happened. A separate encrypted command record
describes whether and how a specific completed command can be reversed or
compensated. It references the activity event and the stable command ID from
ADR-0024, but stores preconditions, inverse parameters, capability leases, and
expiry outside the event payload.

Commands have exactly one class:

| Class                        | Contract                                                                                                   | Examples                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Immediately reversible**   | The inverse is wholly inside the current library and can be revalidated at execution.                      | Favorite and album-membership changes                         |
| **Conditionally reversible** | The inverse is safe only while named resources and invariants remain available.                            | Move to Trash, restore, operations needing retained bytes     |
| **Compensating-only**        | The original side effect cannot be erased; a new, disclosed action can restore an equivalent user outcome. | Recreate a verified Move source at its original external path |
| **Irreversible**             | No Undo or Redo entry is exposed. The activity remains visible.                                            | Permanent purge, key destruction, sent export copies          |

The shared command registry owns labels and invocation. The main process owns
classification and returns a capability snapshot with `available`,
`conditional`, `pending`, `expired`, `unavailable`, or `irreversible`, plus a
stable reason code. Every invocation revalidates the capability; a displayed
snapshot never authorizes execution.

Undo and Redo are per-library durable stacks, ordered by completed command
sequence. They survive restart. Switching libraries swaps the visible stacks
without moving entries across libraries. Undo appends a new activity event and
transitions the command record idempotently; Redo invokes the original command
through the same service boundary and safety checks. Completing a new
undoable command after Undo clears that library's Redo branch. Failed or
pending compensation does not advance either stack.

Permanent deletion and the other Tier-D actions in ADR-0023 never become
undoable. Their confirmation ceremonies cannot be bypassed by an activity or
command record.

### 3. Capability leases and compensation

An inverse operation stores only the minimum before-state required to invoke a
real domain command. It never restores database rows directly and never treats
renderer state as authoritative. The inverse must be deterministic,
idempotent, and subject to current authorization, library-lock, protected-domain,
and conflict rules.

Resources needed only for Undo use explicit capability leases:

- exact external paths and other sensitive inverse parameters live only in
  the encrypted command record, never in the general activity payload;
- retained bytes stay in normal encrypted blob custody and are pinned by
  content hash; command records do not create plaintext or duplicate copies;
- a lease names its byte charge, expiry, and required resource generation;
- pruning cannot remove a live lease; storage pressure may decline a new lease
  or expire the oldest eligible lease, but must update capability state before
  releasing custody.

Move compensation recreates a source only from a content-hash-verified library
original. It re-probes the volume, parent identity, permissions, free space,
and destination immediately before writing. It writes to a private temporary
file, verifies the result, and publishes without replacement. A missing volume
or permission becomes `pending` or `unavailable`; an occupied destination is a
conflict and is never overwritten or silently renamed. Recreating the source
is a new compensating action; it does not claim that the original Move never
happened.

If required bytes, metadata, keys, permissions, or remote state are absent,
the command remains in history with an honest reason. The user may retry a
pending compensation after the environment changes. No fallback may widen the
target, substitute a different file, or weaken verification.

### 4. Retention and storage budgets

Activity metadata and Undo custody have independent budgets:

- activity retains the newest 100,000 events and 365 days per library, with a
  64 MiB encrypted-payload soft budget;
- command stacks retain at most 100 completed commands and 30 days;
- sensitive external-path parameters and Move byte leases expire after 7 days;
- Undo byte leases may consume at most 2 GiB or 10% of currently available
  library-volume space, whichever is smaller.

The shortest applicable time, count, or storage limit wins. Pruning runs in
bounded batches and writes a summary event. A command whose capability lease
expires becomes `expired` before its sensitive parameters or byte pin are
removed. Activity pruning never deletes domain data, operational journals, or
ADR-0023 audit evidence that has a longer governing retention.

If an event cannot be recorded, a mutation in the same transaction fails. For
cross-boundary work that has already become durable, the operational journal
retains an `activity-pending` marker and retries publication; the UI shows the
operation's honest partial state. Failure to allocate an Undo lease does not
roll back a successful domain operation, but the result is recorded as
non-undoable with a reason before success is reported.

Budget constants are schema/configuration policy, not user promises. A later
settings surface may offer shorter retention, but increasing retention or
syncing history requires a privacy review and ADR amendment.

### 5. Privacy, backup, transfer, and deletion

Activity is encrypted at rest under the library's existing SQLCipher custody
and is unavailable while that library is locked. It is local to the library:
it is not sent through interoperability Sync, diagnostics, telemetry, or
ordinary export. Applying a remote operation creates a local event with a
privacy-safe peer identity rather than importing another device's raw history.

Library backup includes encrypted activity so restore preserves the audit
timeline. Restore does not preserve device- or environment-bound Undo
capabilities: command records are revalidated and external-path/permission
leases become unavailable until explicitly re-established. Library transfer
keeps history inside the encrypted library but never exports plaintext paths.
Removing a library from the registry changes no library data. Deleting a
library or destroying its key deletes its history under the same ADR-0023
ceremony and custody as the rest of the library.

Privacy rules by data class:

| Data                  | Rule and threat response                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Filenames/titles      | Activity stores stable entity IDs and resolves the current display value while unlocked. A minimal encrypted snapshot is allowed only when the event would otherwise be unintelligible, and is removed by payload redaction/pruning. |
| External source paths | Never stored in activity, logs, diagnostics, telemetry, sync, or export. A time-bounded encrypted command record may hold an exact path for compensation; general correlation uses a library-keyed HMAC fingerprint.                 |
| Album membership      | Store album and photo IDs plus counts, not a denormalized list of names. Protected-domain IDs remain undiscoverable while authorization is absent.                                                                                   |
| Destructive actions   | Record tier, ceremony authorization ID, affected count, and outcome. Do not copy deleted filenames, keys, confirmation text, or content into the event. ADR-0023 evidence outlives an activity display row when required.            |

This minimizes damage from a copied database, unlocked-process compromise,
diagnostic collection, shoulder surfing, and cross-library query bugs. SQLCipher
does not excuse payload minimization: secrets that are unnecessary after an
Undo window must not remain merely because the database is encrypted.

Main-process pagination is schema-validated, library-bound, and cursor-based on
sequence. Queries enforce current lock and protected-domain authorization on
every page. Counts and generic rows may not reveal hidden protected content.

## Rejected alternatives

### Event sourcing the library

Rejected. Reconstructing library state from activity would couple every schema
migration and operational subsystem to an unbounded replay contract. Existing
tables and purpose-built journals remain authoritative.

### Audit-only history with no durable command records

Rejected. Inferring reversibility from an event type ignores changed paths,
permissions, bytes, keys, and remote state. History and capabilities must be
related but independently represented.

### An in-memory bounded command stack

Rejected. It is simple but disappears on restart, cannot explain partial
cross-boundary work, and encourages renderer-owned authorization.

### Unbounded durable Undo or retaining every inverse byte

Rejected. It turns Undo into an undeclared backup system, retains sensitive
paths and content indefinitely, and still cannot guarantee that external side
effects remain reversible.

### Mutable history rows

Rejected. Updating a single row through retries erases causality and makes
partial failures impossible to audit. Append-only milestones plus explicit
supersession preserve the record without making old payloads permanently
visible.

## Consequences

- Users receive a coherent encrypted activity timeline without making it the
  library's source of truth.
- Undo remains honest: availability is a live capability, not a promise
  inferred from history or UI state.
- Restart and library switching preserve useful stacks; device transfer and
  environmental changes deliberately force revalidation.
- Move compensation can consume bounded encrypted storage and may remain
  pending until an external resource returns.
- Implementation must add transactional event publication, schema migrations,
  pruning, capability evaluation, and accessible reason strings before exposing
  the surfaces described by #614 and #615.
