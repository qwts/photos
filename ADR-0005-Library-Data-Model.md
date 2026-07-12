# ADR-0005: Library Data Model & On-Disk Layout

## Status

Accepted (proposed 2026-07-12 on issue [#66](https://github.com/qwts/photos/issues/66); accepted under the owner's standing work-through-M11 authorization after an open review window — any section may still be amended by owner veto before its implementing code lands)

## Context

M03 builds the encrypted library core; schema v1 and the on-disk story must be
recorded before the first DB code exists so E4.5/E4.6 implement rather than
debate. The mock's per-photo field set
(`design_handoff_overlook_desktop_app/ui_kits/app/photos.js`) defines the
minimum viable columns: name, dimensions, megapixels, size, camera, lens,
iso/f/shutter/focal, place, date, sync status, favorite. The library must stay
responsive at 200K photos (M11 scale target), and the whole database is
encrypted at rest per [ADR-0004](ADR-0004-Encryption-And-Key-Management).

## Decision

**SQLite schema v1** (SQLCipher-encrypted per ADR-0004, WAL mode,
foreign keys on):

- `photos` — `id` (pk), `file_name`, `file_kind` (jpeg/raw/…), `width`,
  `height`, `bytes`, `content_hash` (SHA-256 of the plaintext original,
  unique), `camera`, `lens`, `iso`, `aperture`, `shutter`, `focal_length`,
  `taken_at`, `gps_lat`/`gps_lon` (nullable; display policy in ADR-0006),
  `place`, `imported_at`, `import_source`, `favorite`, `key_id` (fk → `keys`).
  Megapixels derive from width×height at read time — not stored.
- `albums` — `id`, `name`, `created_at`, `position`; `album_photos` —
  `album_id`, `photo_id`, `position` (composite pk) for membership +
  user-defined ordering.
- `sync_ledger` — `photo_id` (pk), `status`
  (`local | syncing | synced | offloaded` — the StatusGlyph vocabulary),
  `last_backup_at`, `dirty` (feeds the toolbar/statusbar `pendingCount`).
- `keys` — `id`, `wrapped_key`, `created_at`, `retired_at` (ADR-0004's
  versioned library keys).
- `schema_migrations` — `version` (integer pk), `applied_at`.

**IDs are ULIDs** — sortable strings, generatable anywhere without
coordination, stable across export/import.

**Content-addressed encrypted blob store.** Originals live at
`blobs/<h[0..2]>/<h[2..4]>/<content_hash>` (two-level fan-out); the file bytes
are the ADR-0004 envelope. Derived images (sizes and formats owned by
ADR-0006: a grid thumb and a mid-size lightbox image) live under `thumbs/`
addressed by the same hash + size suffix. The plaintext `content_hash` in the
DB is the integrity anchor and the duplicate-import check; the envelope's
per-chunk GCM tags authenticate the ciphertext.

**On-disk layout** under Electron `userData`:

```
library.db          # SQLCipher database
blobs/              # encrypted originals, content-addressed
thumbs/             # encrypted derivatives
tmp/                # import staging — same volume, so finalizing a blob
                    # is an atomic rename, never a cross-device copy
```

**Pagination is keyset (cursor), never offset.** The library list/grid reads
pages ordered by `(taken_at DESC, id DESC)` with a `WHERE (taken_at, id) <
(?, ?)` cursor and a covering index. `OFFSET` at 200K rows re-scans the head
on every page and is disallowed from the first query.

**Search is SQLite FTS5** — an external-content table over
`file_name + place + camera`, kept in sync by triggers, matching the mock's
search/filter surface. Semantic search (the "coming soon" label) is out of
scope and arrives with its own ADR.

**Migrations are forward-only and versioned.** Integer versions, each applied
in a single transaction at startup, recorded in `schema_migrations`. No down
migrations — broken migrations roll forward with a fix, mirroring the repo's
ratchet culture.

## Consequences

- E4.5/E4.6 (and later import/backup epics) implement against named tables
  and paths; PRs cite sections here instead of re-opening schema debates.
- Content addressing gives dedup-by-construction on re-import and a stable
  blob↔row link that survives file renames; the cost is that editing a photo's
  bytes (out of scope v1) means a new address, not an in-place write.
- Keyset pagination constrains every future list surface (albums, filters) to
  cursor-friendly orderings — an index per sort order, decided when the sort
  arrives (default sort order is a Settings item in the design).
- `dirty`/`sync_ledger` is deliberately the only writer-visible backup state;
  M08's engine consumes it rather than inventing its own bookkeeping.
- FTS5 and SQLCipher must coexist in the chosen driver build — verified as
  part of ADR-0006's native-module policy before M03 begins.
