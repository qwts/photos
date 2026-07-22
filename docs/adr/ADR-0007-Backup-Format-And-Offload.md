# ADR-0007: Backup Format, Remote Layout, Offload Semantics, Interop Stance

## Status

Accepted (2026-07-13, at M08 start per the standing goal-run authorization;
the owner may veto or amend on issue
[#102](https://github.com/qwts/photos/issues/102) — the M08 engine builds
against these sections)

**Amended 2026-07-22 by
[ADR-0028](./ADR-0028-Remote-Custody-Binding-And-Custody-Safe-Disconnect.md)
(#723):** a transition into `offloaded` additionally records the custody
authority (provider, account, remote root) that verified the upload, and the
failure-truth vocabulary gains a distinct wrong-account state; offloaded
reads and restore are addressed by that recorded authority.

## Context

M08 builds the backup/offload engine; the contract must exist first: what
bytes go to the cloud, in what layout, how uploads are trusted, and what
"offloaded" means for a photo on disk and in the UI. The design promises
client-side-encrypted backup to pCloud, an amber "offloaded" state (55%-dim
tiles), and re-importable blobs. Blob encryption is
[ADR-0004](./ADR-0004-Encryption-And-Key-Management.md); local layout and content
addressing are [ADR-0005](./ADR-0005-Library-Data-Model.md); the sibling product's
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
for corruption recovery. Restore on a new machine requires the recovery phrase
(ADR-0004), latest manifest, and blobs; the wrapped master key never leaves the
device.

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
- **Temporary view/export custody (default):** with **Re-offload after
  viewing** enabled, opening, neighbor-prefetching, or exporting an offloaded
  photo downloads its existing encrypted envelope into a separate bounded
  ephemeral store. The store authenticates every envelope chunk and verifies
  the decrypted content address before it can serve the memory-only full-res
  path. The durable ledger remains `offloaded`; close/navigation/export
  completion releases ownership, inactive ciphertext is LRU-evicted, and
  startup removes abandoned ephemeral files. Plaintext is never written.
- **Keep downloaded / policy off:** **Keep downloaded** atomically promotes
  already-verified ciphertext into the durable blob store before the ledger
  becomes `synced`. Disabling Re-offload after viewing uses that permanent
  verified restore path when a photo is opened.
- **Failure truth:** fetching, verification, ready, released, and error are
  explicit states. Offline/expired auth, missing/corrupt remote objects, and
  cache pressure fail closed without changing durable state. Remote loss is
  coordinated with ADR-0012's integrity-error contract rather than shown as
  a silent placeholder.

**Provider abstraction — mock-first (decision with the owner, epic #44).**
One interface the in-memory/on-disk mock, pCloud, and Google Drive adapters
implement: `put`, `get`, `list`, `delete`, `quota`, `verify` (checksum), plus
auth lifecycle hooks. The engine, tests, restore workflow, and UI consume
capability descriptors rather than provider-name branches.

**Google Drive custody (#277).** The desktop installed-app flow uses the
system browser, PKCE S256, a nonce-bound loopback callback, and only the
`drive.file` scope. The public OAuth client ID is embedded at package build
time through `GOOGLE_DRIVE_CLIENT_ID`; refresh tokens are sealed by OS
`safeStorage` outside the replaceable library directory. The adapter creates
only its app-owned `/Overlook/<library-id>/` tree, persists Drive file/folder
IDs, revalidates stale IDs, paginates listings, uses resumable uploads, and
falls back to download-and-SHA-256 when Drive omits a checksum.

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
- Temporary custody preserves the user's storage choice while still allowing
  viewing and export. It adds a second encrypted local lifecycle, so its byte
  cap, shared-content ownership, provider-switch lock, crash cleanup, and
  plaintext-cache invalidation are tested as security invariants.
- A packaged build without `GOOGLE_DRIVE_CLIENT_ID` keeps Google Drive visible
  but unavailable with an explicit configuration reason; it never starts a
  partial OAuth flow.
