# photos

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
