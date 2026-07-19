# Acceptance Test: Deterministic Reviewed Sync

Issues: [#334](https://github.com/qwts/photos/issues/334) and
[Image Trail #587](https://github.com/qwts/image-trail/issues/587)

## Automated evidence

1. Feed the same Image Trail and Overlook record pair through the resolver in
   different delivery orders. Field winners and merged revision vectors are
   identical.
2. Give two different values concurrent field vectors. The item remains a
   conflict until every field has Keep Image Trail, Keep Overlook, or Keep both.
3. Apply Keep both. The applier receives distinct primary and secondary
   outcomes; a single-winner decision receives no secondary outcome.
4. Replay the same pairing/message identity. Durable item count and audit
   outcome do not inflate. Change its payload and verify the replay fails.
5. Pause after review, close the database, reopen it, and verify the session is
   still paused. Resume, apply, reopen again, and verify apply is idempotent.
6. Receive a newer tombstone. Verify apply is blocked until explicit review.
   Keep leaves the target intact and records skipped; Apply is passed explicitly
   to the injected translation seam.
7. Disconnect and attempt another receipt. Verify it fails closed and neither
   library is deleted.
8. Advance revision checkpoints and verify they only move forward.

## Required gates

- `npm run ci`
- focused Sync resolver, repository, protocol, replay, restart, and migration
  suites

No renderer behavior changes in this issue. Storybook and E2E visible workflow
coverage belongs to #336 and Image Trail #589.
