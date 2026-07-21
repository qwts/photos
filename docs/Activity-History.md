# Activity History

Overlook keeps a privacy-minimized activity timeline inside each library's
encrypted SQLCipher database. The timeline is an audit projection for people;
library tables and purpose-built operational journals remain authoritative.
The governing contract is
[ADR-0025](./adr/ADR-0025-Encrypted-Activity-History-And-Capability-Aware-Undo.md).

## Publication

Only trusted main-process boundaries publish events after an operation reaches
its durable boundary. The first taxonomy covers imports and Move results,
album changes, favorites, Trash and restore, export, and permanent deletion.
Renderer requests can invoke those operations but cannot submit activity rows.

Each event has a stable identity and a transaction-assigned per-library
sequence. The repository treats exact operation retries as idempotent and
rejects conflicting reuse. Sequence, rather than wall-clock time, defines the
timeline order.

## Privacy and custody

- Payloads contain IDs, counts, outcomes, and other minimal facts. External
  paths, filenames, titles, and destinations are rejected.
- History is readable only through the active unlocked library's validated,
  cursor-paginated IPC endpoint. Switching libraries swaps the visible
  timeline; it never combines libraries.
- Backup manifests include the encrypted activity snapshot so restore keeps
  its sequence and event identities. Activity is not included in ordinary
  photo export, interoperability Sync, diagnostics, or telemetry.

## Retention

Activity retains up to 100,000 events and 365 days per library with a 64 MiB
payload soft budget. The shortest limit wins. Active retention holds protect
events required by later Undo work. Pruning emits a summary activity event and
never deletes domain data or operational journals.

## Verification

Repository tests cover migrations, ordering, restart persistence, exact-retry
idempotency, redaction, pruning holds, pagination, restore, and library
isolation. Storybook verifies the accessible timeline states, while Electron
E2E proves that a trusted mutation appears and remains after restart.
