# ADR-0007: Backup Format, Remote Layout, Offload Semantics, Interop Stance

## Status

Proposed (awaiting owner ratification — issue
[#102](https://github.com/qwts/photos/issues/102))

## Context

M08 builds the backup/offload engine; the contract must exist first: what
bytes go to the cloud, in what layout, how uploads are trusted, and what
"offloaded" means for a photo on disk and in the UI. The design promises
client-side-encrypted backup to pCloud, an amber "offloaded" state (55%-dim
tiles), and re-importable blobs. Blob encryption is
[ADR-0004](ADR-0004-Encryption-And-Key-Management); local layout and content
addressing are [ADR-0005](ADR-0005-Library-Data-Model); the sibling product's
formats and pCloud behavior are summarized in the design bundle's
`guidelines/image-trail-interop.md`.

## Decision

**Remote layout — `/Overlook/<library-id>/`.** One folder per library (the
ULID minted at library creation), never shared with other writers:

```
/Overlook/<library-id>/
  manifest/          # encrypted manifest generations (see below)
  blobs/<h2>/<hash>  # encrypted originals, content-addressed (one fan-out
                     # level remotely — provider listings paginate anyway)
```

**Format — E4.3 envelopes travel as-is.** Blobs upload exactly as they sit in
the local store (ADR-0004 chunked AES-256-GCM envelopes) — encrypt-once,
upload-bytes, **no re-encryption and no second format**. The remote is a
mirror of ciphertext the local store already trusts.

**Manifest — encrypted, generation-numbered, enough to re-import without a
local DB.** A manifest generation is a single encrypted document (same
envelope scheme, sealed by the current library key) listing: schema version,
library id, key ids in use, and per-photo rows (photo id, content hash,
byte size, key id, file name, minimal display metadata). A new generation
uploads after each backup batch; the previous N=2 generations are retained
for corruption recovery. Restore-on-new-machine = recovery phrase (ADR-0004)
+ latest manifest + blobs; the wrapped master key never leaves the device.

**Verify-after-upload — checksum compare, not re-download.** The provider
interface exposes a server-side content hash/size check (pCloud offers
checksum calls); uploads are verified by comparing size + provider checksum
against the local ciphertext hash recorded at upload time. Image Trail's
re-download-and-byte-compare buys certainty at double bandwidth — wrong
trade for multi-GB photo libraries. If a provider offers no checksum call,
its adapter must fall back to re-download-verify rather than skip
verification: the `verified` bit is what offload eligibility trusts.

**Offload semantics:**

- **Eligibility:** only photos whose ledger row is `synced` **and** verified
  (the bit above). Nothing dirty, syncing, or unverified ever evicts.
- **Eviction:** the encrypted **original** blob is deleted locally;
  **thumbnails stay** (grid + lightbox mid-size keep working offline). The
  ledger row flips to `offloaded`; the DB row keeps everything else.
- **UI contract:** offloaded tiles dim to 55% with the amber cloud glyph
  (StatusGlyph vocabulary) — the design's existing state.
- **Rehydrate:** opening/exporting an offloaded photo downloads the blob,
  re-verifies its content hash against the DB, restores the ledger row to
  `synced`. Rehydrate failures (offline, provider error) surface as the
  amber `cloud-alert` state, never a silent placeholder.

**Provider abstraction — mock-first (decision with the owner, epic #44).**
One interface both the in-memory/on-disk mock and the pCloud adapter
implement: `put`, `get`, `list`, `delete`, `quota`, `verify` (checksum), plus
auth lifecycle hooks. The engine, tests, and UI states develop against the
mock; the pCloud adapter (#109) arrives when owner credentials exist.

**Image Trail interop stance:** Overlook writes only under `/Overlook/` —
never `/Image Trail/backups/` (that path is the sibling's verified-upload
target; mixing writers risks corrupting its listing trust). Import-from-Image
Trail is **explicitly deferred**; when it comes, it is a translation layer
over Image Trail's export envelopes (per the interop doc's field mapping),
a new Import-dialog source — not a shared live folder or shared format.

## Consequences

- M08 issues implement against named sections (layout, manifest, verify,
  offload lifecycle) and the provider interface; the mock adapter is the
  test double for every engine test.
- Encrypt-once means backup bandwidth and remote storage equal local
  ciphertext size — no transform pipeline to maintain; the cost is that key
  rotation's "old blobs stay on old keys" (ADR-0004) is visible remotely too.
- The manifest makes the remote self-describing for disaster recovery, at
  the cost of one extra encrypted upload per backup batch and a documented
  manifest schema that must version forward-only (mirroring ADR-0005's
  migration policy).
- Checksum-verify makes offload eligibility trustworthy without re-download
  bandwidth; adapters without checksum support pay the re-download price
  rather than weaken the bit.
- Thumbs-stay eviction bounds offload savings (thumbnails remain on disk) —
  accepted so the library stays browsable offline, per the design's offloaded
  UX.
