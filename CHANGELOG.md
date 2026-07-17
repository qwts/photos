# photos

## 0.24.1

### Patch Changes

- 407a707: Add an executable cross-product interoperability acceptance and release-evidence gate.

## 0.24.0

### Minor Changes

- 0c8e98d: Add truthful Image Trail Transfer and Sync entry points plus review, conflict, progress, recovery, provider, pairing, and unavailable-original states.

### Patch Changes

- 71bd82e: Restore launchable macOS releases by requiring a matching provisioning profile for restricted Touch ID entitlements and smoke-testing the packaged artifact.

## 0.23.0

### Minor Changes

- cf96f5c: Add direct photo and selection drag-and-drop organization between albums.
- db88013: Add durable deterministic Sync journals with replay-safe conflict and reviewed-delete decisions.
- e3addd2: Enforce protected-album isolation at main-process query, media, and action boundaries.
- 6582858: Back up, verify, restore, offload, and rehydrate protected-album ciphertext without disclosing protected metadata to cloud providers.
- 26d9e73: Add provider-neutral encrypted interoperability transport and the fail-closed signed iCloud bridge boundary.

## 0.22.0

### Minor Changes

- f081192: Add accessible album rename, delete, and remove-membership workflows.
- 589622b: Add Google Drive as an encrypted backup, offload, and disaster-recovery provider.
- d870623: Add crash-safe, domain-isolated migration custody for protected album photos and derivatives.

### Patch Changes

- 566ad50: Ship Windows packages without compiling the macOS-only Touch ID bridge.

## 0.21.0

### Minor Changes

- a68b86e: Add crash-safe acknowledged Move journals that preserve source originals until target metadata and byte custody are verified.
- 5dae313: Add opt-in native Touch ID unlock on supported signed macOS builds while preserving app-password fallback and fail-closed key custody.
- 5dbbe39: Add the protected-album key-slot, sealed-metadata, and session-authority foundation.

### Patch Changes

- 2cce89b: Keep the root application releasable after adding the local Touch ID native dependency.

## 0.20.0

### Minor Changes

- 74eb06f: Translate and persist Image Trail bookmarks and albums without fabricating native photo metadata.
- 57b8336: Publish the canonical Overlook and Image Trail interoperability contract.

## 0.19.0

### Minor Changes

- 6f122e7: Add a main-process-enforced app password, locked startup and lifecycle triggers, persisted retry throttling, crash-safe credential rotation, recovery-key re-establishment, fail-closed work teardown, and dedicated lock and Privacy settings surfaces.
- 7cda42c: Add orientation-aware lightbox fill, clamped two-axis panning, focal-point zoom from 0.25× to 8×, and accessible zoom/reset controls.

### Patch Changes

- bb473c7: Keep background prefetch and export reads temporary when re-offload-after-viewing is disabled, and prevent an offload-in-progress lightbox from immediately fetching the evicted original again.

## 0.18.0

### Minor Changes

- 8b19085: Add verified temporary viewing and export custody for cloud-only originals, with a default-on re-offload policy and an explicit Keep downloaded action.

## 0.17.0

### Minor Changes

- e05eb99: Add verified manual offload controls to selections, photo context menus, and the lightbox, with exact preflight results, responsive actions, Undo, and Settings controls to restore selected or all offloaded originals.

## 0.16.2

### Patch Changes

- 1ae24a6: Audit existing cloud backups in bounded resumable batches, repair missing or corrupt ciphertext when a local encrypted original remains, surface unrecoverable remote-only loss, and regenerate damaged recovery metadata.

## 0.16.1

### Patch Changes

- 5f81f4d: Hide incomplete and empty pCloud backup folders from restore discovery while preserving completed recovery libraries.

## 0.16.0

### Minor Changes

- cf1914a: Add provider-neutral cloud-library discovery and a staged restore workflow in fresh-profile onboarding and Settings.
- 9ac6aa8: Add provider-addressed cloud selection, explicit capability reporting, safe switching, and provider-neutral backup UI.

## 0.15.0

### Minor Changes

- dc788ec: Add a provider-neutral disaster-recovery engine that resumes authenticated staging, rebuilds encrypted library state, and atomically activates or rolls back a restored cloud library.

### Patch Changes

- 7dc783a: Keep the loaded gallery, selection, and lightbox stable while cloud backup updates photo sync status.

## 0.14.0

### Minor Changes

- a7cd8ef: Add a complete encrypted backup manifest and recovery-key bootstrap so cloud backups contain the provider-neutral metadata and wrapped keys required for disaster recovery.

## 0.13.2

### Patch Changes

- e279f66: Edits now back up themselves: favoriting, album changes, and restores trigger the same quiet auto-backup imports use (when "Back up new imports automatically" is on), so the "ENCRYPTING → PCLOUD" indicator no longer sits until a manual backup.
- 3a4583c: Editing an offloaded photo (album add, favorite) no longer breaks the backup run: its blob is already remote, so the edit rides the next manifest generation and the pending indicator settles without re-uploading anything.

## 0.13.1

### Patch Changes

- 0d8c06e: Fix pCloud sign-in: v0.13.0 shipped with an incorrect OAuth client id, so Connect failed at the authorize step.

## 0.13.0

### Minor Changes

- 83f1d84: pCloud is now the storage provider in packaged builds (#109): Connect in Settings → Storage & Backup opens a pCloud sign-in in the browser, and backup, verify, offload, rehydrate, and the quota card run against the live account. Backups upload under `/Overlook/<library-id>/`, encrypted end-to-end — pCloud only ever sees ciphertext. Dev and test builds keep the local mock provider.

## 0.12.2

### Patch Changes

- b79a874: Provider connect/disconnect now runs through the backup service (`backup:connect` / `backup:disconnect`) instead of a bare settings patch — groundwork for pCloud sign-in (#254). Mock-provider behavior is unchanged; disconnecting now also drops any stored pCloud credentials.

## 0.12.1

### Patch Changes

- 9f8f7dd: macOS builds are now signed with a Developer ID certificate and notarized by Apple; tagged releases publish as full releases instead of unsigned pre-releases (#128). Windows builds remain unsigned pending a certificate.

## 0.12.0

### Minor Changes

- 27d8dd9: Disconnecting pCloud now hides every backup surface instead of showing misleading states: the toolbar backup button disappears, the status bar reads "PCLOUD NOT CONNECTED", the sidebar backup card drops the progress/pCloud figures for a local-only line with a Connect link, and Settings → Storage & Backup hides the backup-specific controls (import Copy/Move stays usable — it needs no provider). Everything restores live on reconnect.
- 6817953: Import is no longer SD-only: the Import dialog gains a source picker — SD card (with a "no card detected" empty state), Local folder (OS picker, scans subfolders), and Dropped (drag photo files anywhere onto the window for a full-window drop overlay that opens the dialog pre-seeded). Move remains exclusive to SD cards: folder and dropped imports force Copy in the UI and the pipeline rejects Move for non-volume sources, so the app never deletes a user's own files. Non-photo drops get a "nothing to import" toast.
- 4a7093b: Recovery key backup and import (Settings → Privacy): export the library's master key as a password-encrypted `overlook-recovery.key` (scrypt + AES-256-GCM, password + confirmation with a strength meter and an explicit cannot-be-reset acknowledgment), and import a `.key` file on another device to unlock a restored library. Install validates the key against the library's stored key rows and never overwrites working custody it can't vouch for; wrong passwords fail closed.

## 0.11.0

### Minor Changes

- 1024f75: Collapsible sidebar: a toggle collapses the navigation to a 56px icon rail — labels and counts move into right-side tooltips, section headings become dividers, and the backup card becomes a shield button that opens Settings. The collapsed state persists across launches. Tooltips now support all four sides and position with fixed viewport coordinates so overflow ancestors can't clip them.

## 0.10.0

### Minor Changes

- 7267943: Real app icon and brand wordmark: packaged mac/win builds now carry the gradient-ringed hexagon product icon (generated from the design handoff icon set), dev runs set the dock/taskbar icon, and the toolbar wordmark is the icon beside "OVERLOOK" filled with the brand gradient (replacing the placeholder aperture glyph).

## 0.9.0

### Minor Changes

- 2e423e6: Brand palette refresh: the primary accent is now the blue-violet iris (`--accent-iris`, matching the new app icon); `--accent-cyan` and `--accent-cyan-dim` are legacy aliases resolving to iris, so selection, focus, primary actions, and active nav all adopt the new hue. Adds `--accent-cyan-bright` / `--accent-violet` gradient ends and the `--brand-gradient` / `--brand-gradient-soft` tokens for brand moments.

## 0.8.1

### Patch Changes

- 35afd9c: Security review (#129): adversarial audit of the crypto envelope/keystore, the IPC registry + custom protocol handlers, and a plaintext-at-rest sweep. All three seams verified sound against the ADR-0004 threat model — no fix-before-release findings. Hardening fix (F1): the test/dev harness env hooks (`OVERLOOK_SEED`, `OVERLOOK_SEED_SYNTHETIC`, `OVERLOOK_IMPORT_SOURCE`, `OVERLOOK_EXPORT_DESTINATION`, `OVERLOOK_BACKUP_FAULT`, `OVERLOOK_USER_DATA`) are now honored only in unpackaged builds via a single `harnessEnv()` gate, matching the existing `OVERLOOK_INSECURE_KEYSTORE` posture — a packaged app can no longer be steered via env. The written review and ADR-0004 accepted-deviation notes live in the wiki; follow-up hardening is tracked in #229 (per-key nonce budget), #230 (central IPC error scrubber), and #231 (protocol least-privilege polish).

## 0.8.0

### Minor Changes

- f7ed6d5: Crash-safety audit (#125): a ConsistencyChecker detects DB↔blob↔ledger drift (orphan blobs/thumbs, staging leftovers, rows lying about a local original) and repairs what is safe — remote-verified missing blobs become `offloaded` (rehydratable), truly lost blobs become `error` (the red glyph is the honest prompt), orphans and staging strands are removed. A lightweight repair runs at library open. The kill-test matrix consolidates: per-stage import resume (existing), backup mid-upload/mid-verify resume (existing), plus new offload and purge crash-window tests and a deliberately-corrupted-store-repairs-to-consistency proof.

### Patch Changes

- 589e5d0: Coverage-map completeness sweep (#126): the design README's full screen/interaction inventory audits against the acceptance ledger — 30 automated entries, one manual-with-reason (visual motion/hover/disabled rules), and two deferred-with-issues for the not-yet-designed set (semantic search results #224, album reordering #225). Distribution recorded in the wiki Testing-Strategy.
- d4498f0: Perf tuning to budget (#124): sidebar counts run as ONE FILTER-clause pass over the ledger join instead of five separate counts (689ms → 378ms at 200K; ratchet tightened to 500ms), with the offloaded predicate now join-based so page() and counts() still share one where-clause truth. Zoom-96 scroll drops stay within budget; the disk-cache lever is rejected on privacy grounds (decrypted thumbs never hit disk — ADR-0004, recorded).

## 0.7.1

### Patch Changes

- e0956dc: Perf harness + budgets (#123): the 200K target becomes measurable — `npm run test:perf` (own Playwright config, never a per-PR gate; manual CI lane via perf.yml) measures cold-start-to-grid, IPC query latency medians (page/counts/search), scroll frame-drop rate at the three design zooms, full-pipeline import throughput, and memory ceilings, writes `perf-report.json`, and asserts the ratchet budgets in `tests/perf/budgets.ts` (recorded with baselines in the wiki Testing-Strategy).

## 0.7.0

### Minor Changes

- 4106eb1: Add to album from the selection pill (#118): a picker popover anchored above the pill lists existing albums with live counts and creates one inline (Enter commits, Escape closes); picking adds the whole selection with the exact-count toast ("Added 12 photos to Big Sur"). Removing from an album stays a follow-up — the design is silent on the album-context action (noted on the epic).
- 65ec43e: Albums CRUD (#117): create/rename/delete albums and add/remove membership over typed `album:*` IPC — deleting an album never deletes photos (Clear-vs-Delete rules) and every album edit dirties the affected photos for the next manifest (ADR-0007). The sidebar Albums section goes live: inline create from the + affordance, live counts, and an album as the active source filtering the grid (`library:page` gains `albumId`).
- 1ff13dd: Permanent purge with retention (#121): the trash pill's destructive Delete opens the confirm ceremony (red button, exact counts, "This can't be undone.") and removes all three copies — DB row first (the local state never lies), local blobs, remote last with retries. A failed remote delete is audited as a repairable ORPHAN-REMOTE (surfaced as an amber "CLOUD COPIES PENDING" toast), shared-hash blobs survive while any row still owns them, and purging owes the remote a fresh manifest generation. Soft-deleted rows auto-purge after 30 days — a fixed constant until a settings control is designed (recorded).
- ec6bfc2: SettingsDialog shell (#112): the design's 640px two-pane frame — 160px icon+label left nav (General / Storage & Backup / Privacy, Storage & Backup default-open), placeholder panes until the sections land, opened from the sidebar gear (which stops stub-toasting).
- 97bae4e: Settings — General section (#113): default sort order (Date / Name / Size) wired to the store and the grid query — a change re-orders the grid live and persists; appearance segmented with Light disabled ("dark only for now" — the DS has no light theme); thumbnails-on-import locked on with its rationale. The library page query gains a keyset-safe `order` parameter (date newest-first, name A→Z, size largest-first).
- 2952418: Settings — Privacy section (#115): end-to-end encryption row with the always-on badge and factual copy, face grouping shipped disabled as "not yet available" (the mock's locked-on state is deferred by design — not faked), and the share-diagnostics switch (off by default, anonymous-only copy; the preference persists while reporting stays local-only).
- a633f83: E2E (#116): settings persist across a real app restart — run one changes sort/Wi-Fi/bandwidth and disconnects the provider, run two proves the store reports them, the grid renders in the persisted order unprompted, the dialog re-renders the disconnected state, and manual backup stays blocked. Also fixes a toast race the suite surfaced: an automatic backup's green "BACKUP COMPLETE" was replacing the import-complete toast — auto successes are now quiet (the status bar still flips); manual runs keep the toast and failures stay loud for every trigger.
- 5520033: Settings — Storage & Backup section (#114): provider connection card (badge, live quota bar from the provider, Connect/Disconnect driving `providerId` — mock connects instantly, live pCloud arrives with #109), auto-backup switch, shared Copy/Move on-import segmented (the ImportDialog now opens with and persists the same setting), Wi-Fi-only switch, bandwidth slider (Unlimited at 100), locked "Encrypt originals". All backup controls disable when disconnected, and a disconnected provider suppresses auto-backup-on-import.
- 3da6b11: Typed settings store (#111): zod schema with design defaults, atomic JSON persistence in userData with per-key corrupt recovery, `settings:get`/`settings:set` IPC plus `settings:changed` pushes. The backup engine now reads throttle/Wi-Fi/auto-backup live from the store, and auto-backup-on-import is active (default on, per the design).
- 73738be: Soft delete (#120): Delete is safe by default — the selection pill's Delete and the lightbox trash button move photos to the Recently deleted source (blobs, ledger, and album membership untouched), where the pill flips to Restore. Deleted rows leave pendingCount and the upload queue; restore brings favorite/EXIF/ledger status back intact and re-dirties the row for the next manifest. Permanent purge is #121's destructive ceremony.

### Patch Changes

- 59719d8: Backup story proven in CI (#110): edit-re-dirties, the offload → lightbox
  rehydrate round-trip, and a fault-injected upload failure surfacing the red
  retry toast + error glyph — via the new OVERLOOK_BACKUP_FAULT harness hook.
  Wi-Fi/throttle honoring stays deterministically covered at the engine
  integration layer until M09's settings pane exposes it live.
- c60b2cd: Source truth (#119): sidebar counts now share `page()`'s per-source where-clauses — one query truth, so counts and grid results cannot drift by construction. A property-style suite pins it: for every source, count === full keyset page-walk total; chips AND with sources ('Local only' means ledger-local, contradictions yield the empty set honestly); deleted rows stay invisible outside the trash.

## 0.6.0

### Minor Changes

- 7d0437f: Backup UI (#108): every design surface goes live off engine events — the
  toolbar backup button triggers the run with the mock's amber/green toast
  pair, the StatusBar's amber "ENCRYPTING n" counts down live and flips to
  "ALL BACKED UP · JUST NOW" off the real stamp, per-photo glyphs ride the
  targeted pushes, and the sidebar card shows the aggregate progress bar plus
  the real LOCAL · PCLOUD storage split.
- 4a4f67d: Offload + rehydrate (#107, ADR-0007): verified-synced originals evict
  locally (thumbnails stay — the library browses offline) with a shared-hash
  guard, flipping tiles to the offloaded state via targeted pushes; touching
  an offloaded photo in the lightbox downloads it back through an atomic
  staged restore that decrypt-and-rehash verifies before publishing — a bad
  download never becomes local truth and failures surface as a red toast.
  Library stats gain the local/cloud byte split, and `backup:offload` /
  `backup:rehydrate` channels expose the flows.

## 0.5.0

### Minor Changes

- 61d8168: Backup engine (#105, ADR-0007): the ledger's dirty set flows to the provider
  as a resumable queue — ciphertext uploads byte-for-byte (encrypt-once), an
  encrypted manifest generation seals per batch (N=2 retained), transient
  failures retry with exponential backoff while auth/quota stop the run, the
  bandwidth throttle rests proportionally between items, the Wi-Fi-only gate
  skips metered networks ('unknown' proceeds as the recorded heuristic), and
  auto-backup-on-import subscribes to the import events. New `backup:run`
  channel and `backup:progress` events for #108's UI.
- 2201afa: Verify-after-upload (#106, ADR-0007): "backed up" is never a lie — the
  engine hashes the local ciphertext and compares sha256+size against the
  provider's checksum before a row may go synced; mismatches go `error` and
  stay dirty (re-queued next run), with every verify result appended to the
  backup audit log. Status changes push targeted library updates so tiles
  flip to the cloud-alert glyph live, and failed runs raise the red toast
  with a Retry action via the new `backup:completed` event.
- b3e3dac: Storage-provider seam (#103, ADR-0007): the typed interface the whole backup
  epic builds against (put/getStream/list/delete/quota/verify + auth state,
  typed ProviderError kinds), a filesystem-backed mock provider with quota and
  connection simulation, a fault-injection wrapper producing every engine
  error path (upload failure, verify mismatch, auth expiry, transient
  download), and a provider registry whose connection states feed the
  settings card. Live pCloud arrives as #109 against the same contract suite.
- c3df7ff: Sync-ledger status machine (#104): the ledger vocabulary gains `error`
  (migration v2 rebuilds the table), transitions are machine-validated
  (illegal ones throw), every library edit dirties through ONE choke-point,
  verified completion clears dirty and stamps `last_backup_at`, and the
  status bar's backed-up label now reads the real stamp ("JUST NOW" /
  "2H AGO", "NEVER" before the first backup). Inspector renders the error
  state ("SYNC FAILED — WILL RETRY").

## 0.4.0

### Minor Changes

- 9546ff4: ExportDialog (#99): the design's 420px export flow with the safety copy
  verbatim — selected-count row, Original/JPEG segmented, "Decrypt originals"
  on by default (off disables Export and shows the amber warning; v1 ships no
  encrypted-export format), destination via the OS folder picker, a single
  progress bar labeled by decrypt state, and a done summary that honestly
  notes preview-capped RAW transcodes.
- be49c3d: Export entry points (#100): the selection pill's Export action goes live
  (dialog opens with the exact selection count, selection preserved through
  the flow) and the lightbox share icon opens the dialog with count=1 for the
  focused photo, replacing the M07 stub toast.
- c610ccd: JPEG transcode export (#98): `format: jpeg` produces universally-openable
  files via sharp at quality 90 — RAW sources transcode from their embedded
  preview (v1 policy) with the preview-capped count surfaced in the summary,
  filenames re-extension to .jpg under the same collision policy, and
  metadata is STRIPPED on transcode per ADR-0006's privacy stance (camera
  identity and GPS travel only when exporting originals).

### Patch Changes

- bd4b9bf: Export proven end-to-end in CI (#101): the OVERLOOK_EXPORT_DESTINATION
  harness hook mocks the OS folder picker for the acceptance flows — select 3
  → pill Export → 3 decrypted files on disk, and a full-circle import-a-RAF →
  lightbox-export-as-JPEG run exercising the preview policy.

## 0.3.0

### Minor Changes

- 0f1fb01: Export engine (#97): selected photos become real files in a chosen folder —
  streaming decrypt straight to the destination with original filenames
  (collisions get a recorded numbered suffix), free-space preflight before any
  bytes move, ordered n/total progress events, and cancellation that finishes
  the file in flight and keeps completed files. New `export:*` IPC surface
  (pick-destination via the OS folder picker, run, cancel, progress). v1 ships
  no encrypted-export format — the dialog's decrypt-off switch will simply
  disable Export (recorded on #97).
- ff70239: ImportDialog (#88): the design's 420px import flow over the real engine —
  options (scanned source card with mono counts, Copy/Move with the verbatim
  Move warning, always-on encrypt switch, exact "Import N photos" count),
  running (two live ProgressBars fed by the engine's copy and thumbnail
  streams), done ("Show in library" jumps to Recent imports). The toolbar's
  Import button now opens it against the first available source.
- 372a47a: Import flow closed out (#90): the full path is proven end-to-end in CI —
  fixture card in (via the `OVERLOOK_IMPORT_SOURCE` harness seam), encrypted
  library out, with no plaintext fixture bytes anywhere in the profile and
  Move sources emptied only after per-file verification. The running dialog
  gains a real Cancel (`import:cancel`): the engine finishes the file in
  flight, keeps everything completed, finalizes the remainder as cancelled
  (sources untouched), and reports exact counts.
- e24a33d: Inspector (#94): the 280px right-docked truth panel — header with thumb,
  name, date · place and StatusGlyph; Encrypted/RAW-JPG/Favorite badges;
  grouped Capture/File/Backup MetadataRows with interpunct-joined mono values.
  Missing EXIF rows are omitted (never fabricated), the backup row states only
  what the ledger knows, and the cipher row reads the photo's real key id. In
  the lightbox the overlay yields the right rail so the panel docks beside the
  photo; in the grid it reflects a single selection.
- 028a728: Lightbox keyboard (#93): ←/→ step the visible filtered sequence with
  wraparound via a pure reducer action shared with the on-screen arrows,
  neighbor prefetch now fires on every lightbox change (keys or clicks),
  i/I toggles the Inspector, and Esc keeps its dual semantics — all without
  clicking to focus.
- 58bc8a4: Lightbox mutations (#95): the favorite toggle is proven end-to-end — ledger
  dirties (pendingCount), StatusBar flips amber with exact counts, and the
  grid tile's star appears via targeted change pushes with no reload. The
  delete control is explicitly labeled as the M10 soft-delete seam.
- 1c676a9: Lightbox (#92): full-window image-first view over the decrypt-to-view
  delivery layer — aspect-fit photo via `overlook-full://`, PREVIEW badge on
  RAW records, top bar (back/favorite/export/inspector/delete), side arrows
  with wraparound and neighbor prefetch, EXIF strip on the protect-gradient,
  and chrome that fades in on mousemove and auto-hides after 2.2s idle.
- 74c80e4: Import completion toast (#89): a clean import shows the green "Imported N
  photos" toast (exact counts) with a Show action that jumps to Recent imports;
  toasts now auto-dismiss at 4s per the design's ToastHost. The toast action is
  a serializable marker in the shared reducer, mapped to its handler by the
  shell.

### Patch Changes

- 351aff8: Lightbox chrome can now actually auto-hide while the pointer rests on it:
  Chromium re-dispatches a synthetic mousemove when the fade's pointer-events
  flip changes hit-testing under a stationary cursor, which re-woke the chrome
  in a loop. Stationary events are now ignored; only real movement wakes.

## 0.2.0

### Minor Changes

- da48b62: App state store and composition shell: a pure reducer holds the mock's app
  state (query, zoom, view, source, chips, selection, lightbox, inspector,
  dialogs, toast, pending count), provided to the renderer via context with IPC
  push events dispatching into it. The app now boots into the composed chrome —
  title bar, toolbar region, sidebar with live source counts, content region,
  optional inspector, and status bar — with global keys (⌘/Ctrl+A, Esc, `i`)
  wired through the reducer.
- faf5d94: Encrypted blob store: content-addressed originals and thumbnails under the
  library layout — every byte streams through the AES-256-GCM envelope before
  touching disk (staging included), writes land by fsync + atomic rename,
  reads decrypt by key id, and a verify walk re-checks every auth tag plus the
  content address. Orphan scanning backs the future repair story.
- 3e3b78c: Core design-system controls land: Button (primary/secondary/ghost/danger,
  sm/md/lg), IconButton (with active tint), Badge (five tones, uppercase mono
  pill), and Tooltip (top/bottom, 200ms fade) — pixel-matched to the design
  specimen card, tokens only.
- 718875a: Crypto engine: streaming AES-256-GCM envelopes per ADR-0004 — 4 MiB chunks
  with per-chunk auth tags, AAD binding photo id / key id / chunk index, a
  truncation-detecting final marker, and key-versioned decryption. Tamper,
  reorder, truncation, wrong-key, and wrong-context all fail loudly.
- 1610701: Design tokens land in the renderer: the five Overlook token files (colors,
  typography, spacing, elevation, fonts) become the styling source of truth,
  IBM Plex Sans/Mono bundle locally (OFL), and the shell renders a token
  specimen page (neutrals, accents + dims, type scale).
- c2327e8: Deterministic dev seed: `npm run seed:dev` fills an empty library with
  mock-shaped, envelope-encrypted sample photos and the four design albums
  through the real crypto/blob/database path; E2E boots seeded fresh temp
  profiles via OVERLOOK_USER_DATA/OVERLOOK_SEED, and a metadata-only synthetic
  variant backs future 200K perf work.
- 67ad989: Electron desktop shell scaffold: `npm run dev` opens a window rendering the
  React shell placeholder. Main/preload/renderer processes exist with security
  defaults (no nodeIntegration, contextIsolation, sandboxed renderer);
  `npm run build` now produces the app bundle in `out/` via electron-vite.
- d2bee22: EXIF extraction for the import pipeline: exifr (pure JS per ADR-0006) behind
  a pure module producing the Inspector's field set — camera (make+model,
  deduped), lens, ISO, aperture and shutter formatted like the mock, focal
  length, dimensions, taken-at, GPS coordinates per the ADR privacy stance.
  RAF files resolve their embedded JPEG via the documented header offsets;
  missing or corrupt metadata degrades to an all-null record — never an
  exception, never a fabricated value.
- 8a9d4af: Feedback and media primitives: ProgressBar (4px animated track, three
  tones, mono counters), StatusGlyph (the five sync states with the design's
  labels in a blurred capsule, spinning while syncing), and MetadataRow
  (uppercase-mono label + truncating value) — the pieces import, backup, and
  inspector surfaces consume.
- 430131d: Frameless window chrome: macOS uses native traffic lights over a hidden-inset
  title bar, Windows/Linux run frameless with minimize/maximize/close driven
  over typed IPC. The window enforces a 960×600 minimum, paints the design's
  near-black background before first render, and the renderer's top 30px strip
  drags the window.
- 252224d: Full-resolution decrypt-to-view delivery (#91): `overlook-full://` serves
  originals decrypted in memory under a byte-capped LRU (configurable via
  `OVERLOOK_FULL_CACHE_MB`), with `Cache-Control: no-store` keeping plaintext
  out of Chromium's disk cache. RAW records resolve to their viewable embedded
  preview (by magic, per ADR-0006) with an `X-Overlook-Preview: 1` marker, and
  `?prefetch=1` warms neighbors for stall-free lightbox paging.
- 7309475: The grid becomes real: virtualized cells render PhotoTiles fed by the page
  data — thumbs over the decrypting protocol, favorite badge, sync-status glyph
  (the page query now joins the sync ledger so every photo carries its sync
  state), select circle vs open click, and live zoom from the toolbar slider.
  An impossible filter or empty library shows the mock's "Nothing matches"
  empty state. Under active search/chip filters the scroll plane tracks the
  loaded count until exact filtered totals land with the toolbar work.
- f752de0: Import engine (#87): source files become encrypted, verified library records
  through a per-file pipeline (hash → skip-if-known → encrypt-stream → EXIF →
  single-transaction record with a dirty sync-ledger row → thumbnails), driven
  over the new `import:run` channel with two aggregate progress events
  (copy+encrypt and thumbnails). A staging-manifest journal makes every batch
  interruptible: a relaunch resumes idempotently, and Move deletes each source
  file only after that file's blob passes a full decrypt-and-rehash
  verification — per file, never end-of-batch.
- 92ad475: Import sources (M05 begins): removable-volume enumeration (macOS /Volumes,
  Windows drive letters, udisks mounts on Linux) plus the manual folder path,
  and a media scan producing the design's source-card numbers — total, NEW via
  full-file SHA-256 presence against the library (the blob store's own content
  address, so a re-scan after import reports zero new), RAW/JPG split, and
  bytes — with progressive counts pushed for big cards over the new
  `import:list-sources` / `import:scan-source` channels.
- 2ba3dc9: Input form controls: Slider (value-tracking fill, proper stylesheet thumb),
  Switch (real switch role, locked-on checked+disabled pattern), Checkbox
  (hidden native input, indeterminate mixed state) — keyboard and
  screen-reader correct.
- 978d1d4: Master-key lifecycle: the master key is generated on first run and persists
  only OS-keychain-wrapped; versioned library keys (KEY #N) wrap under it,
  rotate forward while retired keys keep decrypting, and an unavailable
  keychain is a hard error — never a plaintext fallback.
- c5a2324: Library IPC service: the renderer's typed window into the library — paged
  queries with source, chip, and search filters (mock-exact substring
  semantics), photo lookup, favorite toggle that bumps pendingCount, sidebar
  counts, and StatusBar stats, plus targeted library.changed /
  pendingCount.changed push events. The library lazily boots on first use:
  keychain-backed keys, SQLCipher database, and blob store under userData.
- 1408b6b: List view: the dense 52px-row alternative, virtualized through the same
  engine in a single-column row mode — 40px protocol thumb, name, place · date,
  camera, size (mono), favorite star, and sync-status glyph, with the identical
  selection contract (circle toggles, row opens). The toolbar's Grid/List
  segmented switches views; the zoom slider hides in list view; toggling
  preserves selection exactly and scroll position approximately via the
  engine's anchor restoration.
- f2ab3ca: Overlay primitives: Dialog (scrim, focus trap, Esc/backdrop close,
  aria-modal) and Toast (four tones, aria-live, bottom-right host with 4s
  auto-dismiss) — the base every import/export/settings flow dialog builds on.
- 8514ac8: PhotoTile: the grid's cell with the full state matrix — selection ring with
  0.92 image scale, hover overlay and select circle, favorite star, sync
  status capsule, offloaded dimming — and independent open/select click
  targets.
- 71a10ec: Selection model completed per the mock: selection now survives filter and
  source changes for still-visible photos (intersected with each freshly
  loaded page instead of clearing eagerly), and a floating bottom-center pill
  shows "{n} SELECTED" with thousands separators plus the bulk-action entry
  points — Export, Add to album, Delete (disabled until their epics land) and
  clear-×. ⌘/Ctrl+A keeps selecting the visible set; Esc clears (lightbox owns
  Esc when open).
- d69e868: Sidebar: the 216px navigation rail per the mock — Library sources with live
  counts and cyan active-icon highlight, an Albums section listing the
  library's albums with membership counts over a new `library:albums` channel
  (display-only until M10), and the backup status card: encrypted badge,
  settings entry (M09 stub), an inert backup-progress slot while photos are
  pending, and the mono storage line from library stats. Counts, stats, and
  albums refresh on targeted library-changed pushes, so favorite toggles
  live-update the rail.
- 8d13729: Encrypted library database: SQLCipher-keyed SQLite (whole-DB at rest per
  ADR-0004), forward-only transactional migrations with schema v1, and a typed
  photos repository — keyset pagination, atomic insert with sync-ledger row,
  favorite toggle that dirties the ledger, and sidebar source counts.
- 37e987f: StatusBar: the 26px mono strip per the mock — "N PHOTOS · size" with
  thousands separators on the left; the right side flips between the amber
  spinning "ENCRYPTING n → PCLOUD" while photos are pending and the green
  "ALL BACKED UP · <relative>" otherwise (driven by ledger events; the engine
  itself is M08), plus the permanent AES-256 lock. A shared relative-time
  formatter (JUST NOW / 5M AGO / 2H AGO / 3D AGO) ships unit-tested for M08's
  real backup stamps.
- 644ac04: Thumbnail delivery: the `overlook-thumb://` protocol streams decrypts from
  the encrypted blob store straight into `<img>` tags — memory-only, no
  plaintext files. Main keeps a byte-capped LRU of decrypted thumbs over a
  small decrypt semaphore with in-flight dedup and cancellation for
  scrolled-past requests; content-addressed responses ship immutable cache
  headers so the renderer's HTTP cache short-circuits repeats. Missing thumbs
  404 (renderer placeholder until M05 backfills). The dev/E2E seed now writes
  real encrypted thumbs and its sample JPEGs actually decode.
- 9c35a56: Thumbnail generation worker (#86): a bounded `worker_threads` pool runs sharp
  off the main thread producing the ADR-0006 derivatives (512px WebP q80 thumb,
  2048px WebP q85 mid — sRGB, metadata stripped), RAF originals resolve their
  embedded preview first, undecodable bytes record a placeholder instead of
  failing the import, and derivatives stream encrypted into the blob store
  (encrypt-then-move, no plaintext temp files). A crashed worker rejects only
  its own job and the pool respawns without leaking capacity.
- 38f2479: TitleBar chrome: the 30px frameless-window bar is now a real component — mac
  reserves the native traffic-light inset, Windows/Linux get custom
  minimize/maximize/close controls (close hovers red) driving the typed window
  IPC; the whole bar drags the window.
- 854c109: Toolbar form controls: SearchField (shortcut hint, cyan focus, clear
  affordance), Chip (filter pill with selected state and removable ×), and
  Segmented (exclusive options, icon-only with tooltip, arrow-key operable).
- b914cc3: Toolbar: the full 48px command strip per the mock — cyan-aperture wordmark,
  debounced search wired to live library queries, funnel-toggled filter chips
  (Favorites / RAW / Offloaded / Local only, plus the SEMANTIC SEARCH hint),
  Grid/List segmented, zoom slider (visibility-hidden in list view), a backup
  button driven by pending-count state (disabled when everything is backed up),
  and the primary Import entry point. Backup/Import surface stub toasts until
  M08/M05 land; library stats now include the pending count so the backup state
  is honest from first paint.
- 769d5af: Typed IPC contract layer: all renderer↔main traffic rides a zod-validated
  channel/event registry (`src/shared/ipc`); the renderer sees only the typed
  `window.overlook` surface, malformed traffic rejects at the boundary, and a
  main→renderer event pattern (window focus demo) is in place for progress and
  settings pushes.
- 6fb9659: Virtualized grid engine for the 200K target: exact row/column math as a pure
  shared module (auto-fill columns, stretched square tiles, 4px gaps), windowed
  rendering with overscan, cursor-page data windowing with stale-request
  cancellation, zoom-anchor scroll restoration, and frame-drop instrumentation
  for the M11 perf budgets. The shell's content region now scrolls the real
  library; `npm run seed:perf` boots a 200,000-row synthetic profile for
  baselines.
