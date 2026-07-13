# M10: Albums, organization & deletion

**Epic:** [#45](https://github.com/qwts/photos/issues/45) · **Lane:** Lane A — UI (tail)

Lane A tail. User albums (CRUD + sidebar list + add-from-selection picker), the sidebar source filters wired to real queries (Favorites, Recent imports, Offloaded, Local only), and safe deletion: soft delete into a **Recently deleted** source with restore, and permanent purge with retention rules (destructive confirm; cleans blobs and, once M08 exists, cloud copies).

## Issues

| # | Title | Blocked by |
| --- | --- | --- |
| [#117](https://github.com/qwts/photos/issues/117) | Albums: CRUD, membership, sidebar list | #69, #80 |
| [#118](https://github.com/qwts/photos/issues/118) | Add to album from the selection action pill | #117, #78 |
| [#119](https://github.com/qwts/photos/issues/119) | Sidebar source filters wired to real queries | #79, #80 |
| [#120](https://github.com/qwts/photos/issues/120) | Soft delete: Recently deleted source + restore | #117 |
| [#121](https://github.com/qwts/photos/issues/121) | Permanent purge with retention | #120, #107 |
| [#122](https://github.com/qwts/photos/issues/122) | E2E: album and delete/restore flows | #118, #119, #120, #121 |

## Acceptance coverage

| Flow | Status | Coverage |
| --- | --- | --- |
| Albums CRUD + membership over `album:*` IPC (delete never deletes photos — Clear-vs-Delete; every album edit dirties affected photos for the manifest, ADR-0007); sidebar live: inline create, counts, album-as-source grid filter (`library:page` gains `albumId`) | ✅ #117 (PR #216) | `tests/e2e/albums.spec.ts` + `tests/db/library-db.test.ts` — ledger id `m10-albums-crud` |
| Add to album from the pill: picker popover (live counts, inline create, focus moves in on open), whole-selection add, exact-count toast ("Added 12 photos to Big Sur") | ✅ #118 (PR #219) | e2e + `SelectionPill.stories.tsx` — ledger id `m10-add-to-album` |
| Source truth: `counts()` shares `page()`'s where-clauses (drift impossible by construction); property suite — every source count === keyset page-walk total, chips AND, 'Local only' = ledger-local, deleted rows invisible outside trash | ✅ #119 (PR #217) | `tests/db/source-truth.test.ts` |
| Soft delete: pill + lightbox routes → Recently deleted; deleted rows leave pendingCount and the upload queue; restore intact (favorite/EXIF/ledger status) and re-dirties; deleting a SYNCED row owes + quietly pushes a fresh manifest generation (restore-from-backup can never resurrect) | ✅ #120 (PR #218) | `tests/e2e/trash.spec.ts` + `tests/db/soft-delete.test.ts` — ledger id `m10-soft-delete-restore` |
| Permanent purge: destructive confirm (red, exact counts over a SNAPSHOTTED selection, "This can't be undone."), DB row → local blobs → remote last with retries; failures audited as repairable ORPHAN-REMOTE; shared-hash blobs survive; 30-day auto-retention sweep at library open | ✅ #121 (PR #220) | e2e (fs-level remote assertion) + `tests/library/purge-service.test.ts` — ledger id `m10-purge-retention` |
| Acceptance flows (album create/add/filter; delete → trash → restore; purge with confirm + remote deletion) | ✅ #122 (delivered in-spec with each PR) | `albums.spec.ts` + `trash.spec.ts` |

Recorded decisions: album creation is an inline name row under the sidebar + (design gives the affordance, no flow); rename/delete ship IPC-only until a surface is designed; album drag-and-drop reordering deferred by design; remove-from-album is a follow-up (design silent on the album-context pill action); purge retention is a fixed 30 days until a settings control is designed; purge order is DB-first/remote-last so the local state never lies.

## Definition of done

See the epic issue [#45](https://github.com/qwts/photos/issues/45) — the epic body is canonical; this page is the planning index entry.
