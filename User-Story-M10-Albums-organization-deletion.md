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

## Definition of done

See the epic issue [#45](https://github.com/qwts/photos/issues/45) — the epic body is canonical; this page is the planning index entry.
