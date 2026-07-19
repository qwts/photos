# ADR-0015: Deterministic Reviewed Sync Journals

## Status

Accepted 2026-07-16 on [#334](https://github.com/qwts/photos/issues/334),
paired with [Image Trail #587](https://github.com/qwts/image-trail/issues/587).
This ADR implements the Sync decisions in
[ADR-0014](./ADR-0014-Image-Trail-Bidirectional-Interoperability.md) without changing
the canonical v1 envelope.

## Context

Vector clocks identify whether each canonical field is older, newer, equal, or
concurrent, but they do not make review state durable. Delivery can repeat or
arrive in a different order, either process can restart, and a delete tombstone
must never become an implicit target deletion. Renderer state and provider
queues are not safe sources of truth for those decisions.

## Decision

Both products will use the same product-role resolver. Each field compares its
Image Trail and Overlook revision vectors. Strictly newer fields win; equal
values merge their clocks; divergent equal or concurrent values become
explicit per-field conflicts. The roles never depend on receive order, so the
same pair produces the same analysis.

Each product persists Sync sessions, items, replay receipts, and append-only
audit evidence in its encrypted application database. The session records the
reviewed first-run direction and scope, connection state, phase, and monotonic
per-product checkpoints. The item records both canonical product versions,
analysis, per-field decisions, delete review, apply state, and failures.

`(pairingId, messageId)` remains the replay identity. An exact replay returns
the existing durable item and cannot increment progress. Reusing that identity
with different content fails closed.

Keep Image Trail and Keep Overlook select the named product value, independent
of which product performs the apply. Keep both produces an explicit secondary
apply request; the product translation boundary owns allocation of the second
native/canonical identity. Apply-to-all is explicit and affects only the
current item's known conflict fields.

A newer tombstone always enters delete review. Apply is impossible until the
durable decision is `apply`; `keep` records a skipped outcome. Pause survives
restart. Cancel and disconnect stop future work without deleting either
library. Provider transport and renderer updates remain separate seams.

## Consequences

- Resolution and progress are deterministic, replay-safe, and restartable.
- Conflict and delete choices are auditable without storing them in renderer
  state or provider objects.
- Product translation remains the only native-library write boundary, so Sync
  cannot directly disturb selection, active view, albums, or backup queues.
- Keep both requires the injected applier to allocate a second identity.
- Transport ordering, provider errors, and visible review flows remain the
  companion transport and UI issues.
