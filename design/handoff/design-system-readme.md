# Overlook — Photos App Design System

**Overlook** is a design system for a high-performance, privacy-first desktop photos app (Electron or Tauri shell). The library is stored locally (SQLite + on-disk originals/thumbnails), **encrypted at rest**, and backs up/offloads to **pCloud** as encrypted blobs that can be re-imported locally. Target scale: **200K+ images**, so the UI is built around virtualized grids, pre-generated thumbnails, and instant-feeling interactions.

## Product context

Core v1 features the system covers:
- **Library grid** — the app opens straight into a full-bleed, edge-to-edge tile grid of the whole library. No welcome screen.
- **Lightbox** — clicking a tile expands the photo to fill the window; the window resizes to the image's aspect.
- **Import** — folder/device import with thumbnail generation progress.
- **Export** — originals or resized, with/without metadata.
- **Metadata inspector** — EXIF, file info, encryption + sync status.
- **Search & filter** — text search now; semantic/vector search later (search field is designed to grow into it).
- **Albums & arranging** — sidebar collections, drag-to-album.
- **Encrypted cloud backup/offload** — pCloud sync states surface per-photo and globally.

## Inferred design decisions (v1 — to be guided)

1. **Dark-first, chrome-recessive.** Photos own all the color; UI is near-black cool neutrals with hairline borders. No light theme yet.
2. **Type:** IBM Plex Sans (UI) + IBM Plex Mono (metadata, EXIF, counts, sync states). Mono is a signature: anything machine-generated renders in uppercase tracked mono.
3. **Accents (shared lightness/chroma, hue varies):** cyan = selection/primary, amber = cloud/offloaded, green = encrypted/verified, red = destructive.
4. **Density:** compact desktop chrome (13px base, 28px controls, 4px spacing scale), 4px grid gap, tight radii (3–6px).
5. **Sync/encryption as first-class UI:** every photo tile can carry a status glyph (local / offloaded / syncing / encrypted); the status bar shows library-wide state.
6. **Motion:** fast and functional — 120–200ms ease-out fades/scales only. No bounces.
7. **Frameless window, real desktop chrome.** Overlook ships in a frameless Electron/Tauri window — there's no OS title bar, menu bar, or scrollbar chrome to lean on. `TitleBar` (mac: reserves space for native traffic lights via `hiddenInset`; win/linux: draws its own min/max/close) sits above the Toolbar in every window and owns the top drag region. This is a desktop app, not a page — no browser-only affordances (address bars, page-level scrolling assumptions, hover-only nav with no keyboard path).

## Sources

- No codebase, Figma, or brand assets were provided for Overlook itself — this is a from-scratch system built on the brief in chat (July 2026).
- [github.com/qwts/photos](https://github.com/qwts/photos) was attached but contains no code (license file only) — not used as a source.
- [github.com/qwts/image-trail](https://github.com/qwts/image-trail) — a related sibling product (browser extension, encrypted URL/image bookmarking with pCloud backup). Its real source informs `guidelines/image-trail-interop.md` (data-format/pCloud interop notes) — read that repo directly for anything beyond what's summarized there.
- Fonts copied from [google/fonts](https://github.com/google/fonts) (OFL — see `assets/fonts/OFL.txt`).
- Icons: **Lucide** via CDN (see ICONOGRAPHY).
- Placeholder "photos" in `assets/thumbs/` are programmatically generated abstract gradients — **replace with real sample images** for true evaluation.

## CONTENT FUNDAMENTALS

- **Voice:** calm, technical, confident. Short sentences. The app addresses the user as "you"; never "we". Sentence case everywhere ("Back up automatically", not "Back Up Automatically").
- **Numbers are exact and mono:** "1,204 photos", "842 / 1,204", "1.2 TB" — never "lots" or "~1200". Thousands separators always.
- **Machine data is uppercase tracked mono:** EXIF, sync states, counts, file names in metadata contexts ("ENCRYPTED · PCLOUD · 2H AGO"). Human-facing prose stays sans, normal case.
- **The `·` interpunct** joins metadata fragments ("26.1 MP · 6240×4160 · 54.2 MB").
- **Security copy is factual, not scary:** "Originals stay on disk, encrypted with your key." Never marketing-speak ("military-grade").
- **Buttons state the outcome with counts:** "Import 1,204 photos", "Delete 12 photos" — not "OK"/"Confirm".
- **No emoji, ever.**

## VISUAL FOUNDATIONS

- **Backgrounds:** flat, cool near-black (`--gray-0` window, `--gray-1` panels, `--gray-2` cards). No gradients except protection scrims over photos (`--protect-grad`). No textures, patterns, or illustrations.
- **Color:** photos are the only saturated content. Chrome is neutral; the four accents (cyan/amber/green/red, shared L/C in oklch) appear only as small semantic marks — glyphs, badges, rings, progress fills. Each accent has a `-dim` 16%-alpha fill for tinted chips/badges.
- **Type:** IBM Plex Sans 400/500/600 for UI (13px base); IBM Plex Mono 400/500 for machine data, uppercase +0.04em tracking. Never more than these two families.
- **Spacing:** 4px scale; compact desktop density (28px controls, 48px toolbar, 26px status bar). Photo grid: 4px gaps, edge-to-edge, tiles zoom 96–320px, square crop in grid.
- **Radii:** tiles 3px, controls 4px, cards/popovers 6px, dialogs 10px, pills full. Nothing larger.
- **Borders:** 1px hairlines in low-alpha white (`--border-1` 8%, `--border-2` 14%) do most separation work; shadows are secondary.
- **Elevation:** shadow-1 rows/chips, shadow-2 menus/toasts, shadow-3 dialogs. Dialogs sit on a 72% scrim.
- **Hover:** fills lighten one gray step (transparent → gray-3 → gray-4); text brightens muted → body. Press: one step darker. 120ms ease-out.
- **Selection:** inset 2.5px cyan ring + image shrinks to 92% inside the tile (check appears top-left). Sidebar/list selection = gray-3 fill + cyan icon.
- **Motion:** 120ms (state) / 200ms (chrome fades) with `cubic-bezier(0.2,0,0,1)`. Opacity + small transforms only; no bounces, no springs. Lightbox chrome auto-hides after ~2s idle.
- **Transparency/blur:** only on glyph capsules over photos (70% dark + 4px blur) and photo-protection gradients.
- **Imagery:** photos render un-treated (no filters, no duotone). Offloaded photos dim to 55%.

## ICONOGRAPHY

- **System:** [Lucide](https://lucide.dev) via CDN (`https://unpkg.com/lucide@0.462.0/dist/umd/lucide.min.js`), rendered through the `Icon` component. Stroke 1.75, sizes 14/16/20. No icon font, no PNGs, no emoji, no hand-drawn SVGs, no unicode-as-icon.
- **Fixed vocabulary** (use these, don't improvise): grid `layout-grid`, list `list`, search `search`, filter `funnel`, albums `album`, favorite `star`, delete `trash-2`, import `download`, export `share`, inspector `info`, settings `settings-2`, encrypted `lock`/`shield-check`, key `key-round`, cloud states `cloud`/`cloud-upload`/`cloud-download`/`cloud-check`/`cloud-alert`, syncing `refresh-cw`, local disk `hard-drive`, database `database`, camera `camera`, place `map-pin`, brand mark `aperture`.
- **No logo exists.** The wordmark is "OVERLOOK" set in Plex Sans 600, +0.14em tracking, beside a cyan `aperture` glyph. Replace when a real mark is provided.

## Index

- `styles.css` — global entry; imports everything in `tokens/` (fonts, colors, typography, spacing, elevation).
- `guidelines/` — foundation specimen cards (colors ×3, type ×3, spacing, radii, elevation, grid system, iconography, wordmark) plus `image-trail-interop.md` (data/pCloud interop notes with the sibling Image Trail product).
- `components/core/` — Icon, Button, IconButton, Badge, Tooltip, TitleBar.
- `components/forms/` — SearchField, Chip, Segmented, Slider, Switch, Checkbox.
- `components/feedback/` — Dialog, Toast, ProgressBar.
- `components/media/` — PhotoTile, StatusGlyph, MetadataRow.
- `ui_kits/app/` — interactive desktop app mock (grid → lightbox → inspector, import flow, export flow, settings, backup states). See its README.
- `assets/fonts/` — IBM Plex binaries (OFL). `assets/thumbs/` — generated placeholder "photos" (replace with real samples).
- `SKILL.md` — agent skill entry point.

### Intentional additions
No source defined a component inventory (from-scratch system), so the standard set above was authored to the app's needs. `StatusGlyph`, `PhotoTile`, `MetadataRow`, and `SearchField` are domain components invented for this product.

