# Handoff: Overlook — Photos App Design System

## For the developer / Claude Code
This bundle is the **design system** for a privacy-first desktop photos app ("Overlook"). Everything here is a **design reference written in HTML/CSS/JSX** — it shows the intended look, tokens, components, and interactions. It is **not** the production app. Your job is to **implement the real app in this repo** using these designs as the source of truth for visual + interaction design, while choosing the appropriate production stack (the brief targets an Electron or Tauri desktop shell with a local encrypted SQLite library + pCloud backup).

Start by reading **`readme.md`** — it is the full written specification (product context, voice, visual foundations, iconography, component inventory). This file just tells you how to consume the bundle.

## What changed since the last handoff (read first)
The design moved on in a few places — the app is mostly built, so these are the deltas to apply:
- **Palette:** primary accent is now blue-violet **iris** (`--accent-iris`), not cyan; `--accent-cyan` aliases to it. New `--brand-gradient` (cyan → iris → violet) + `--accent-cyan-bright`/`--accent-violet`.
- **App icon + wordmark:** real hexagon icon shipped (`assets/overlook-icon.png`, `assets/icon-set/`, `assets/Overlook.iconset/`); wordmark uses it with gradient text.
- **Import:** source picker (SD card / Local folder / dropped) + drag-and-drop onto the window; Move only for SD.
- **Sidebar:** collapsible to a 56px icon rail (persists in `localStorage`).
- **pCloud disconnect:** hides all pCloud UI (toolbar backup, status-bar sync, sidebar backup progress) instead of showing misleading states.
- **Recovery key:** new `KeyDialog` (Settings → Privacy) for password-encrypted key backup/import.
See `readme.md`'s app section (`README.md` in this bundle) for the full per-screen detail.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, elevation, and motion are final and defined as tokens. Recreate the UI to match. `assets/thumbs/` contains cropped derivatives of the licensed real-photo fixtures recorded in `tests/fixtures/photos/manifest.json`.

## What's in the bundle
- `readme.md` — **the spec.** Read this first.
- `styles.css` — global entry; imports everything in `tokens/`.
- `tokens/` — fonts, colors, typography, spacing, elevation (the design tokens).
- `guidelines/` — foundation specimen cards (colors, type, spacing, radii, elevation, grid, iconography, wordmark). Reference for exact values.
- `components/` — component specs in `core/`, `forms/`, `feedback/`, `media/`.
- `ui_kits/app/` — an **interactive desktop app mock** (grid → lightbox → inspector, import flow, backup states). Open `ui_kits/app/index.html` to see the whole app assembled. This is your primary reference for how screens compose. Its `.jsx` files show layout/behavior — recreate them in your chosen framework, don't ship them as-is.
- `assets/fonts/` — IBM Plex Sans + Mono binaries (OFL licensed, see `OFL.txt`).
- `assets/thumbs/` — real-photo sample derivatives for visual evaluation.

## How to view it
Open `Overlook Design System.html` (the design-system overview) and `ui_kits/app/index.html` (the app mock) in a browser. All paths are relative — keep the folder structure intact.

## Design tokens (authoritative source)
Pull exact values from `tokens/` and the `guidelines/` specimen cards rather than eyeballing. Summary from the spec:
- **Type:** IBM Plex Sans 400/500/600 (UI, 13px base); IBM Plex Mono 400/500 for machine data (EXIF, counts, sync states) — uppercase, +0.04em tracking.
- **Color:** cool near-black neutrals (`--gray-0` window → `--gray-2` cards); **primary accent `--accent-iris`** (blue-violet, oklch hue ~278, matches the app icon) for selection/primary/focus/active — `--accent-cyan` is a legacy alias that now resolves to iris. A `--brand-gradient` (cyan → iris → violet, via `--accent-cyan-bright` + `--accent-violet`) is used for the wordmark/brand moments. Status accents: amber (cloud/offloaded), green (encrypted/verified), red (destructive); each has a `-dim` 16%-alpha fill.
- **Spacing:** 4px scale; 28px controls, 48px toolbar, 26px status bar; grid gaps 4px, tiles 96–320px square.
- **Radii:** tiles 3px, controls 4px, cards/popovers 6px, dialogs 10px, pills full.
- **Borders:** 1px hairlines, `--border-1` 8% / `--border-2` 14% white.
- **Elevation:** shadow-1 (rows/chips) → shadow-3 (dialogs on a 72% scrim).
- **Motion:** 120ms state / 200ms chrome fades, `cubic-bezier(0.2,0,0,1)`. Opacity + small transforms only. No bounces/springs.

## Icons & app icon
Lucide (`https://unpkg.com/lucide@0.462.0`), stroke 1.75, sizes 14/16/20. Fixed icon vocabulary is listed in `readme.md` → ICONOGRAPHY. No emoji, no icon fonts, no hand-drawn SVGs.

The **product app icon** now exists: a gradient-ringed hexagon over a twilight scene. Transparent master at `assets/overlook-icon.png`, full PNG set in `assets/icon-set/` (16–1024), and an Apple `assets/Overlook.iconset/` (run `iconutil -c icns Overlook.iconset` to produce `Overlook.icns` for the desktop build).

## Suggested build order
1. Set up the desktop shell (Electron/Tauri) + your framework.
2. Port `tokens/` into your styling layer (CSS vars, Tailwind theme, etc.).
3. Build core + form + feedback components to match `components/`.
4. Assemble the app screens following `ui_kits/app/` (Sidebar, Toolbar, LibraryGrid, Lightbox, Inspector, StatusBar, ImportDialog).
5. Wire real data: local SQLite library, thumbnail generation, encryption at rest, pCloud sync states.
