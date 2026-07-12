# Handoff: Overlook Desktop App (Photos)

## Overview
Overlook is a privacy-first desktop photos app (Electron/Tauri shell) with a local encrypted library, pCloud-backed encrypted backup, and standard library workflows: browse/zoom a grid or list, open a lightbox, inspect EXIF/sync metadata, import from an SD card or drive, export (with decrypt), and manage settings (general, storage & backup, privacy). This bundle covers the whole desktop app shell as demonstrated in the interactive mock.

## About the Design Files
The files in this bundle are **design references written in HTML/CSS/JSX** — an interactive prototype showing intended look, layout, and behavior. They are **not production code to copy directly**. Your job is to **recreate these designs in the target codebase's existing environment** (React, Vue, Swift, native, etc.) using its established patterns and libraries — or, if no environment exists yet, choose the most appropriate stack (the brief targets an Electron or Tauri desktop shell with a local encrypted SQLite library + pCloud backup) and implement there.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, elevation, and motion are final and defined as design tokens (see below) — recreate pixel-for-pixel. The "photos" in `assets/thumbs/` are placeholder generated gradients; swap in real images. Copy is final and should ship as written (see Content voice below).

## Screens / Views

### 1. Library grid (default view)
- **Purpose:** Browse the full photo library.
- **Layout:** `TitleBar` (30px, frameless-window chrome) → `Toolbar` (48px) → body (`Sidebar` 216px fixed + flexible content) → `StatusBar` (26px). Grid uses CSS grid, `repeat(auto-fill, minmax(zoompx, 1fr))`, 4px gaps, square aspect-ratio tiles, zoom range 96–320px via a slider.
- **Components:** `PhotoTile` (rounded 3px, selection ring `inset 0 0 0 2.5px cyan`, hover overlay, favorite star top-right, sync-status glyph bottom-right, select-circle top-left on hover/selected). Multi-select shows a floating pill action bar (Export / Add to album / Delete / clear) centered at the bottom.
- **States:** empty state (no matches) shows a centered icon + message. Cmd/Ctrl+A selects all visible; Escape clears selection.

### 2. Library list (toggle from Toolbar's Grid/List segmented control)
- **Purpose:** Dense, scannable alternative to the grid — same selection model.
- **Layout:** Rows, 52px tall, 40×40 thumbnail, name + place/date, camera, file size, favorite star, sync-status glyph. Zoom slider hides (not just disables) when list view is active — no tile size to control.

### 3. Lightbox
- **Purpose:** Full-window single-photo view.
- **Layout:** Image centered, `object-fit: cover` within available space keeping aspect ratio. Chrome (top bar with back/favorite/export/inspector/delete, side arrows, bottom EXIF strip) fades in on mouse move and auto-hides after ~2.2s of inactivity. Bottom strip uses a bottom-anchored protect-gradient (`--protect-grad`) for text legibility over photos, not a solid bar.
- **Interactions:** ←/→ navigate, Esc returns to grid, `i` toggles the inspector panel (280px, right-docked).

### 4. Inspector
- **Purpose:** EXIF/file/backup metadata for the focused photo (grid selection or lightbox).
- **Layout:** Right-docked panel, `MetadataRow` pairs (uppercase mono label + value), grouped by concern (file, camera, backup/sync status with colored status text e.g. "ENCRYPTED · PCLOUD · 2H AGO").

### 5. Import dialog
- **Purpose:** Import from an SD card or external drive.
- **Layout:** `Dialog` (420px), source card (drive icon, name, new/total counts), "Generate thumbnails on import" checkbox, a **Copy/Move** segmented control ("On import") — Move shows an inline amber warning that originals will be deleted from the source — "Encrypt originals" switch (always on, disabled, lock icon). Footer: Cancel / "Import N photos" primary button with the exact count.
- **States:** options → running (two `ProgressBar`s: copying/encrypting, generating thumbnails, both mono-labeled with `n / total` counts) → done (green checkmark + summary, footer becomes "Show in library").

### 6. Export dialog
- **Purpose:** Get photos out of the encrypted library as real files.
- **Layout:** `Dialog` (420px). Selected-count summary row. Format segmented control (Original/JPEG). **"Decrypt originals" switch, on by default** — this is the important one: files are stored encrypted at rest, so decryption is required to produce files openable outside the app. Turning it off disables the Export button and shows an inline amber warning. Destination row with a "Choose folder…" button. Footer: Cancel / "Export N photos".
- **States:** options → running (single progress bar, label reflects whether decrypting) → done (green check + summary, e.g. "N photos exported and decrypted").
- **Entry points:** the multi-select action bar's Export button, and the lightbox toolbar's export icon (single photo, `count=1`).

### 7. Settings dialog
- **Purpose:** App-wide preferences, most importantly pCloud/backup configuration.
- **Layout:** `Dialog` (640px), left nav (160px, icon + label rows) + right content pane. Three sections:
  - **General:** default sort order (segmented), appearance (segmented, dark/light), "Generate thumbnails on import" (locked on).
  - **Storage & Backup** (default-open section): pCloud connection card (icon, connected/not-connected badge, account email + quota bar when connected, Connect/Disconnect button), "Back up new imports automatically" switch, the same Copy/Move segmented as Import, "Wi-Fi only" switch, "Upload bandwidth limit" slider (10–100%, "Unlimited" at max), "Encrypt originals" (locked on). All backup-specific controls disable when not connected.
  - **Privacy:** end-to-end encryption (badge, always on), face grouping (on-device, locked on), "Share diagnostics" switch (off by default, anonymous-only).
- **Entry point:** gear icon on the sidebar's "Library encrypted" backup-status card.

### 8. Sidebar
- **Purpose:** Library navigation — sources (All Photos, Favorites, Recent imports, Offloaded, Recently deleted), user albums, and a backup-status card at the bottom (shield-check "Library encrypted" + gear/settings entry, a `ProgressBar` for in-progress backup, and a `1.2 TB LOCAL · 380 GB PCLOUD` mono summary line).

### 9. Toolbar
- **Purpose:** Wordmark, search, filters, view toggle, zoom, backup, import.
- **Layout:** 48px, fixed height. Wordmark (aperture icon + tracked-caps "OVERLOOK") sized to match sidebar width. `SearchField` (300px). Filter funnel icon-button (opens a chip row below: Favorites/RAW/Offloaded/Local only + "SEMANTIC SEARCH — COMING SOON" mono label). Grid/List segmented. Zoom slider (hidden in list view). Backup icon-button — **disabled with tooltip "All photos backed up" when there's nothing new to back up**, active/tooltips "Back up now" otherwise (tracked via a `pendingCount` that increments on any library edit, e.g. favoriting, and clears when a backup completes). Primary "Import" button.

### 10. Status bar
- **Purpose:** Library-wide state, always visible, 26px, mono uppercase.
- **Layout:** Left: `N PHOTOS · size`. Right: either "ENCRYPTING n → PCLOUD" (amber, spinning refresh icon) while `pendingCount > 0`, or "ALL BACKED UP · <relative time>" (green, cloud-check icon) when idle. Always-visible "AES-256" lock indicator.

## Interactions & Behavior
- **Selection:** click a tile's/row's circle (or hover to reveal it) to multi-select; click the tile/row itself to open. Cmd/Ctrl+A selects all currently-filtered/visible photos; Escape clears selection (when the lightbox is closed) or exits the lightbox (when open).
- **Backup dirtiness:** `pendingCount` starts non-zero (simulating unsynced changes); any edit (e.g. toggling a favorite) increments it; clicking Back Up transitions amber "encrypting" → green "backed up," resets the counter to 0, and updates the relative "last backup" label to "JUST NOW". The toolbar's backup button is disabled whenever the counter is 0 — there is nothing to protect against re-uploading unchanged data.
- **Animations:** 120ms for state changes (hover/press fills), 200ms for chrome fades (lightbox toolbar, protect-gradient), `cubic-bezier(0.2,0,0,1)` easing throughout. Opacity and small transforms only — no bounce/spring easing anywhere.
- **Hover states:** subtle lighter fill (`--gray-2` → `--gray-3` → `--gray-4` for hover/press progression), never a color-hue change.
- **Disabled states:** 45% opacity + `pointer-events: none` (see `IconButton`, `Switch`).

## State Management
Needed state (see `ui_kits/app/index.html` for the reference shape): photo list, search query, zoom level, view mode (grid/list), active source/filter, selection set, lightbox photo id, inspector open/closed, import/export/settings dialog open flags, toast, and the backup `pendingCount`/`lastBackupLabel` pair described above.

## Design Tokens
Full source in `tokens/*.css` (copied into this bundle) — pull exact values from there, not by eyeballing the screenshots.

**Color** (oklch, dark-first, hue 250 neutrals): `--gray-0` … `--gray-4` (window → pressed fill), `--white-1/2/3` (text body/muted/faint). Accents share L/C=0.74/0.125, hue varies: cyan 215° (selection/primary), amber 75° (cloud/offloaded), green 155° (encrypted/success), red hue 25 at L0.62/C0.19 (destructive) — each has a 16%-alpha `-dim` fill variant. Hairlines: `--border-1` 8% white, `--border-2` 14% white. `--scrim` 72%-alpha modal backdrop.

**Typography:** IBM Plex Sans (UI) + IBM Plex Mono (metadata/EXIF/counts, always uppercase + 0.04em tracked). Sizes: 11/12/13/15/18/24px (`--text-xs` … `--text-display`); base UI is 13px. Weights 400/500/600.

**Spacing:** 4px scale (`--space-1` 2px … `--space-9` 48px). Fixed chrome: titlebar 30px, toolbar 48px, statusbar 26px, sidebar 216px, inspector 280px. Controls: 24/28/34px (sm/md/lg).

**Radii:** tiles 3px, buttons/inputs/chips 4px, cards/popovers 6px, dialogs 10px, pills 999px.

**Elevation:** shadow-1 (rows/chips) → shadow-2 (popovers) → shadow-3 (dialogs, paired with the scrim).

**Motion:** `--ease-out: cubic-bezier(0.2,0,0,1)`, durations 120ms (fast/state) and 200ms (normal/chrome).

## Content voice (copy rules — apply verbatim)
- Calm, technical, confident, short sentences. Addresses the user as "you", never "we". Sentence case everywhere ("Back up automatically", not "Back Up Automatically").
- Numbers are exact and mono, with thousands separators: "1,204 photos", "842 / 1,204" — never "lots" or "~1200".
- Machine data (EXIF, sync states, counts, filenames in metadata contexts) renders uppercase tracked mono. Human-facing prose stays sans, normal case.
- The `·` interpunct joins metadata fragments: "26.1 MP · 6240×4160 · 54.2 MB".
- Security copy is factual, never marketing-speak: "Originals stay on disk, encrypted with your key" — not "military-grade encryption".
- Buttons state the outcome with counts: "Import 1,204 photos", "Export 12 photos" — never bare "OK"/"Confirm".
- No emoji, ever.

## Assets
- `assets/fonts/` — IBM Plex Sans + Mono webfont files (OFL-licensed).
- `assets/thumbs/` — placeholder generated-gradient "photos"; replace with real sample images before final review.
- Icons: [Lucide](https://lucide.dev) via CDN, stroke width 1.75, sizes 14/16/20 — no icon font, no hand-drawn SVGs, no emoji. Fixed vocabulary is listed in the design system's `readme.md` under ICONOGRAPHY.
- No product logo exists yet — the wordmark is "OVERLOOK" set in Plex Sans 600 at +0.14em tracking next to a cyan `aperture` glyph. Replace when a real mark is provided.

## A note on file extensions in this bundle
Every `.jsx`, `.d.ts`, and `.html` file in this folder has a `.txt` suffix appended (e.g. `Button.jsx.txt`, `index.html.txt`). That's only to keep this reference copy inert inside the authoring tool that produced it — **strip the trailing `.txt` before use** (e.g. `Button.jsx.txt` → `Button.jsx`) and everything opens/runs exactly as it did in the original design system.

## Files
- `Overlook Design System.html`, `readme.md`, `HANDOFF_TO_CLAUDE_CODE.md` — the full design-system spec and its own developer handoff notes (broader than just this app — read for full context on voice/tokens/components).
- `styles.css` + `tokens/` — global CSS entry and the token files described above.
- `components/` — reusable primitives referenced throughout these screens (`core/`: Icon, Button, IconButton, Badge, Tooltip, TitleBar, Dialog; `forms/`: SearchField, Chip, Segmented, Slider, Switch, Checkbox; `feedback/`: ProgressBar, Toast; `media/`: PhotoTile, StatusGlyph, MetadataRow).
- `ui_kits/app/` — the interactive reference implementation: `index.html` (app state + composition — start here), `Toolbar.jsx`, `Sidebar.jsx`, `LibraryGrid.jsx`, `Lightbox.jsx`, `Inspector.jsx`, `ImportDialog.jsx`, `ExportDialog.jsx`, `SettingsDialog.jsx`, `StatusBar.jsx`, `photos.js` (fake library data), `README.md`.
- `guidelines/` — foundation specimen cards (colors, type, spacing, radii, elevation, iconography, wordmark) plus `image-trail-interop.md`, notes on a **sibling product** ("Image Trail," a separate browser extension) relevant only if you're building cross-app import/export — not part of this app's core scope, safe to ignore unless asked for.

Not yet designed: album drag-and-drop reordering, semantic search results UI (the search field and a "coming soon" label exist; there's no results treatment yet).
