# Handoff: Overlook Desktop App (Photos)

## Overview
Overlook is a privacy-first desktop photos app (Electron/Tauri shell) with a local encrypted library, pCloud-backed encrypted backup, and standard library workflows: browse/zoom a grid or list, open a lightbox, inspect EXIF/sync metadata, import from an SD card / local folder / drag-and-drop, export (with decrypt), and manage settings (general, storage & backup, privacy). This bundle covers the whole desktop app shell as demonstrated in the interactive mock.

## Recent design updates (delta since the previous handoff)
Re-read these — several things changed since the last drop:
1. **New brand palette.** The primary accent moved from cyan to a blue-violet **"iris"** (`--accent-iris`, oklch hue ~278) that matches the new app icon. `--accent-cyan` is now a **legacy alias that resolves to iris**, so any code keyed to the old token adopts the new hue automatically. Added `--accent-cyan-bright` (true cyan) and `--accent-violet` as the two ends of a new `--brand-gradient` (cyan → iris → violet). Status hues (amber/green/red) are unchanged.
2. **Real app icon + wordmark.** There is now a finished icon: a gradient-ringed hexagon over a twilight mountain/lake scene, transparent-background PNG at `assets/overlook-icon.png` (+ `assets/icon-set/` 16–1024 and `assets/Overlook.iconset/` for `iconutil`). The toolbar wordmark is this icon next to "OVERLOOK" set in the `--brand-gradient`. The old "no logo yet / aperture glyph" note is obsolete.
3. **Collapsible sidebar.** A toggle at the sidebar's top collapses it to a 56px icon rail (icons centered, labels/counts hidden, section headings become dividers, the backup card becomes a single shield button, tooltips on the right). State persists in `localStorage` (`overlook.sidebarCollapsed`).
4. **Import got a source picker + drag-and-drop.** Import is no longer SD-only: a segmented **SD card / Local folder** picker (plus a **Dropped** option when files are dragged in), a "no SD card detected" empty state, a folder chooser, and **Copy/Move restricted to SD** (folder & dropped imports force Copy so a user's own files are never deleted). Dropping photo files anywhere on the window shows a drop overlay and opens Import pre-seeded with those files.
5. **pCloud disconnect hides pCloud UI.** When not connected, the toolbar backup button, the status-bar sync line, and the sidebar backup progress all disappear (status bar shows "PCLOUD NOT CONNECTED"; sidebar shows local-only storage + a Connect link) rather than showing misleading "backed up" states.
6. **Recovery key backup/import** (`KeyDialog`). New in Settings → Privacy: export the library key to a password-encrypted `.key` file (password + confirm, strength meter, explicit "cannot be reset" acknowledgment) and import a `.key` on another device (file + password) to unlock the library. This is local key management, independent of pCloud.
7. **Tooltip** now supports `side="left"|"right"` and positions with `fixed` coordinates so it can't be clipped by an `overflow` ancestor (used by the collapsed rail).

## About the Design Files
The files in this bundle are **design references written in HTML/CSS/JSX** — an interactive prototype showing intended look, layout, and behavior. They are **not production code to copy directly**. Your job is to **recreate these designs in the target codebase's existing environment** (React, Vue, Swift, native, etc.) using its established patterns and libraries — or, if no environment exists yet, choose the most appropriate stack (the brief targets an Electron or Tauri desktop shell with a local encrypted SQLite library + pCloud backup) and implement there.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, elevation, and motion are final and defined as design tokens (see below) — recreate pixel-for-pixel. `assets/thumbs/` contains licensed real-photo derivatives for evaluating the media surfaces. Copy is final and should ship as written (see Content voice below).

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
- **Purpose:** Import from an SD card, a local folder, or files dragged onto the window.
- **Source picker:** a segmented control at the top — **SD card / Local folder** (a third **Dropped** segment appears when the dialog was opened by a drag-and-drop). SD card shows the mounted card (drive icon, name, new/total counts) or a **"No SD card detected"** empty state with a shortcut to switch to Local folder. Local folder shows a **"Choose a folder…"** dropzone, then the chosen path + photo count/size. Dropped shows the count/size of the dragged files.
- **Layout:** source row (per above), "Generate thumbnails on import" checkbox, a **Copy/Move** segmented control ("On import"), "Encrypt originals" switch (always on, disabled, lock icon). Footer: Cancel / "Import N photos" with the exact count for the active source (disabled until a source is available).
- **Move safety:** Move is **only offered for SD card**; folder and dropped imports force Copy (Move is disabled + a note explains source files are left untouched) so the app never deletes a user's own files. SD-card Move shows the amber "originals will be deleted from the card" warning.
- **Drag-and-drop:** dropping image files (RAW/JPEG/PNG/HEIC/TIFF) anywhere on the window shows a full-window **"Drop photos to import"** overlay and opens this dialog with the Dropped source pre-selected; non-photo drops show a "nothing to import" toast.
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
  - **Privacy:** end-to-end encryption (badge, always on); **Recovery key** row (see `KeyDialog` below) with the key fingerprint and **Back up… / Import…** buttons; face grouping (on-device, locked on); "Share diagnostics" switch (off by default, anonymous-only).
- **Entry point:** gear icon on the sidebar's "Library encrypted" backup-status card.
- When pCloud is **not connected**, the backup-specific controls (auto-backup, Wi-Fi only, bandwidth) are **hidden**, not just disabled; only the connection card, import Copy/Move, and "Encrypt originals" remain.

### 7b. Recovery key dialog (`KeyDialog`)
- **Back up:** password + confirm fields (show/hide toggle), a live password-strength meter, the key fingerprint, and an explicit "this password cannot be reset or recovered" checkbox gating the "Export key backup" action → success card for the encrypted `overlook-recovery.key` file + a store-it-safely warning.
- **Import:** a `.key` file dropzone + password field → "Unlock & import" installs the key so a library backed up elsewhere can be decrypted on this device.
- Local key management — independent of pCloud connection.

### 8. Sidebar
- **Purpose:** Library navigation — sources (All Photos, Favorites, Recent imports, Offloaded, Recently deleted), user albums, and a backup-status card at the bottom (shield-check "Library encrypted" + gear/settings entry, a `ProgressBar` for in-progress backup, and a `1.2 TB LOCAL · 380 GB PCLOUD` mono summary line).
- **Collapsible:** a toggle at the top collapses the sidebar to a **56px icon rail** — icons centered in fixed squares, labels/counts hidden, section headings become 24px dividers, and the backup card becomes a single shield button (opens Settings). Each rail icon shows a right-side tooltip. Collapsed state persists in `localStorage` under `overlook.sidebarCollapsed`.
- **Disconnected:** when pCloud isn't connected the backup `ProgressBar` and pCloud figure are replaced with a local-only storage line and a "pCloud not connected — Connect" link (opens Settings).

### 9. Toolbar
- **Purpose:** Wordmark, search, filters, view toggle, zoom, backup, import.
- **Layout:** 48px, fixed height. Wordmark (**the Overlook app icon** + "OVERLOOK" set in the `--brand-gradient`) sized to match sidebar width. `SearchField` (300px). Filter funnel icon-button (opens a chip row below: Favorites/RAW/Offloaded/Local only + "SEMANTIC SEARCH — COMING SOON" mono label). Grid/List segmented. Zoom slider (hidden in list view). Backup icon-button — **disabled with tooltip "All photos backed up" when there's nothing new to back up**, active/tooltips "Back up now" otherwise; **hidden entirely when pCloud is not connected**. Primary "Import" button.

### 10. Status bar
- **Purpose:** Library-wide state, always visible, 26px, mono uppercase.
- **Layout:** Left: `N PHOTOS · size`. Right: **"PCLOUD NOT CONNECTED"** (faint, cloud-off icon) when disconnected; otherwise "ENCRYPTING n → PCLOUD" (amber, spinning refresh icon) while `pendingCount > 0`, or "ALL BACKED UP · <relative time>" (green, cloud-check icon) when idle. Always-visible "AES-256" lock indicator.

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

**Color** (oklch, dark-first, hue 250 neutrals): `--gray-0` … `--gray-4` (window → pressed fill), `--white-1/2/3` (text body/muted/faint). **Primary accent is `--accent-iris`** (oklch 0.70 / 0.16 / hue 278 — blue-violet, matching the app icon) used for selection/primary/focus/active; `--accent-cyan` is a legacy alias resolving to iris. Gradient ends: `--accent-cyan-bright` (hue ~218) and `--accent-violet` (hue ~305), combined in `--brand-gradient` (cyan → iris → violet) for the wordmark/brand moments. Status hues share L/C=0.74/0.125: amber 75° (cloud/offloaded), green 155° (encrypted/success), red hue 25 at L0.62/C0.19 (destructive) — each has a 16%-alpha `-dim` fill variant. Hairlines: `--border-1` 8% white, `--border-2` 14% white. `--scrim` 72%-alpha modal backdrop.

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
- `assets/thumbs/` — licensed real-photo sample derivatives; provenance lives in `tests/fixtures/photos/manifest.json`.
- Icons: [Lucide](https://lucide.dev) via CDN, stroke width 1.75, sizes 14/16/20 — no icon font, no hand-drawn SVGs, no emoji. Fixed vocabulary is listed in the design system's `readme.md` under ICONOGRAPHY.
- **App icon / wordmark:** the product mark is a gradient-ringed **hexagon over a twilight mountain/lake scene** — transparent-background master at `assets/overlook-icon.png`, full size set in `assets/icon-set/` (16–1024) and an Apple `assets/Overlook.iconset/` (run `iconutil -c icns Overlook.iconset` for a `.icns`). The wordmark is this icon next to "OVERLOOK" in Plex Sans 600 (+0.14em tracking) filled with `--brand-gradient`.

## A note on file extensions in this bundle
Every `.jsx`, `.d.ts`, and `.html` file in this folder has a `.txt` suffix appended (e.g. `Button.jsx.txt`, `index.html.txt`). That's only to keep this reference copy inert inside the authoring tool that produced it — **strip the trailing `.txt` before use** (e.g. `Button.jsx.txt` → `Button.jsx`) and everything opens/runs exactly as it did in the original design system.

## Files
- `Overlook Design System.html`, `readme.md`, `HANDOFF_TO_CLAUDE_CODE.md` — the full design-system spec and its own developer handoff notes (broader than just this app — read for full context on voice/tokens/components).
- `styles.css` + `tokens/` — global CSS entry and the token files described above.
- `components/` — reusable primitives referenced throughout these screens (`core/`: Icon, Button, IconButton, Badge, Tooltip, TitleBar, Dialog; `forms/`: SearchField, Chip, Segmented, Slider, Switch, Checkbox; `feedback/`: ProgressBar, Toast; `media/`: PhotoTile, StatusGlyph, MetadataRow).
- `ui_kits/app/` — the interactive reference implementation: `index.html` (app state + composition — start here), `Toolbar.jsx`, `Sidebar.jsx`, `LibraryGrid.jsx`, `Lightbox.jsx`, `Inspector.jsx`, `ImportDialog.jsx`, `ExportDialog.jsx`, `SettingsDialog.jsx`, `KeyDialog.jsx` (recovery-key backup/import), `StatusBar.jsx`, `photos.js` (fake library data), `README.md`.
- `guidelines/` — foundation specimen cards (colors, type, spacing, radii, elevation, iconography, wordmark) plus `image-trail-interop.md`, notes on a **sibling product** ("Image Trail," a separate browser extension) relevant only if you're building cross-app import/export — not part of this app's core scope, safe to ignore unless asked for.

Album reordering is specified by #225's `Album Reorder.html`: ordinary albums use a dedicated expanded-rail handle plus keyboard and menu commands; album rows remain photo-drop targets. Not yet designed: semantic search results UI (the search field and a "coming soon" label exist; there's no results treatment yet).
