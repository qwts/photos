# Accessibility Audit — WCAG 2.2 AA (July 2026)

> The baseline audit for epic [#381](https://github.com/qwts/photos/issues/381),
> produced by [#398](https://github.com/qwts/photos/issues/398). Every finding below is
> either a filed issue or an accepted exception with a rationale. The automated counts are
> frozen as a ratchet in `tests/a11y/violation-budget.json`; see
> [Testing Strategy](Testing-Strategy) for the lanes and
> [ADR-0001](ADR-0001-Automation-Check-Governance) for the gate.
>
> **Re-run this audit** when a child of #381 lands, or when `axe-core` is bumped:
>
> ```sh
> OVERLOOK_A11Y_REPORT=/tmp/a11y.jsonl npm run test:stories:ci
> ```

## Scope

Every shipped surface: Shell, Toolbar, Sidebar, TitleBar, StatusBar, VirtualGrid /
ListRow / PhotoTile / SelectionPill, Lightbox, Inspector, Settings panes, all dialogs
(Import, Export, Offload, Key, Interop, Album, Purge), Toast, and the lock / protected
surfaces ([#305](https://github.com/qwts/photos/issues/305)).

Two methods, because neither is sufficient alone:

1. **Automated** — axe-core 4.12.1 against the `wcag2a`, `wcag2aa`, `wcag21a`,
   `wcag21aa`, `wcag22aa` tags, over all 107 stories and 5 composed E2E flows.
2. **Manual source + interaction audit** — the criteria axe cannot test. In practice axe
   detects roughly a third of WCAG issues; everything in
   [Manual findings](#manual-findings) below is invisible to it.

## Baseline: 103 automated violations

| | Violations | Surfaces |
| --- | --- | --- |
| Story lane (isolated components) | **89** | 64 of 107 stories |
| E2E lane (composed app) | **14** | 5 of 5 flows |

### By rule

| Rule | Count | Impact | WCAG SC | Owner |
| --- | --- | --- | --- | --- |
| `color-contrast` | 61 | serious | 1.4.3 | [#409](https://github.com/qwts/photos/issues/409) |
| `target-size` | 10 | serious | **2.5.8** (new in 2.2) | [#415](https://github.com/qwts/photos/issues/415) |
| `button-name` | 9 | **critical** | 4.1.2 | [#410](https://github.com/qwts/photos/issues/410) |
| `aria-progressbar-name` | 4 | serious | 4.1.2 | [#410](https://github.com/qwts/photos/issues/410) |
| `nested-interactive` | 4 | serious | 4.1.2 | [#412](https://github.com/qwts/photos/issues/412) |
| `aria-prohibited-attr` | 1 | serious | 4.1.2 | [#400](https://github.com/qwts/photos/issues/400) |

### By component (story lane)

`App/SettingsDialog` 22 · `App/Sidebar` 14 · `Interop/Transfer and Sync` 10 ·
`App/ImportDialog` 5 · `Grid/ListRow` 5 · `Grid/SelectionPill` 4 · `App/Inspector` 4 ·
`App/KeyDialog` 3 · `App/LockScreen` 3 · `Feedback/Primitives` 3 ·
`App/ProtectedAlbumCeremony` 2 · `Grid/VirtualGrid` 2 · `App/ExportDialog` 2 ·
`App/ProtectedAlbumView` 2 · `Media/PhotoTile` 2 · plus 6 surfaces at 1 each.

**Read this distribution with care.** It counts axe rule-instances per story, so it
reflects how often a surface is *storied*, not how broken it is. 61 of the 89 story
violations come from **two colour tokens**. The honest summary is: _four root causes
produce 84 of the 103 violations._

## Severity ranking

Ranked by user impact, not by count.

### S1 — blocks a screen-reader user from completing a task

| # | Finding | Owner |
| --- | --- | --- |
| 1 | **The Lightbox is a modal that is not a dialog.** No `role="dialog"`, no `aria-modal`, no focus trap, no initial focus, no focus restore. The whole shell stays in the a11y tree and Tab order underneath it. `Dialog.tsx` already does all of this correctly. | [#399](https://github.com/qwts/photos/issues/399) |
| 2 | **Lightbox chrome auto-hides after 2.2s of mouse idle with no keyboard wake path.** `onMouseMove` is the only waker, so a keyboard-only user's controls vanish and never return (**2.2.1**, and **2.4.7** if focus lands on a faded control). | [#399](https://github.com/qwts/photos/issues/399) |
| 3 | **`VirtualGrid` has no a11y surface at all** — no `role`, no `aria-rowcount`/`aria-setsize`/`aria-posinset`. With virtualization only ~2 overscan rows exist in the DOM, so AT announces "3 of 40" for a 40,000-photo library: **actively false**, not merely absent. Every mounted tile is `tabIndex={0}` and there is no roving focus, so Tab steps photo-by-photo with no way past the grid. | [#399](https://github.com/qwts/photos/issues/399) · [#400](https://github.com/qwts/photos/issues/400) |
| 4 | **9 critical `button-name`**: every `Switch` in Settings is nameless — backup, privacy, and encryption toggles announce as "switch, checked" with no subject. | [#410](https://github.com/qwts/photos/issues/410) |
| 5 | **Toasts auto-dismiss in 4s, taking their action button with them.** The app's primary async channel; the action is unreachable in the time available and unrecoverable after (**2.2.1**). | [#411](https://github.com/qwts/photos/issues/411) |

### S2 — serious: information lost or wrong

| # | Finding | Owner |
| --- | --- | --- |
| 6 | **`--text-faint` never reaches 4.5:1 on any surface** (3.24–4.15 measured). It is the default colour of `.mono-data` — so the app's entire machine-readable layer (EXIF, counts, sync states) is sub-AA. 51 CSS usages. | [#409](https://github.com/qwts/photos/issues/409) |
| 7 | **`--accent-red` on `--accent-red-dim`** — the resting `.ovl-button--danger`, 3.37–4.45 vs 4.5. The destructive control is the one that is hardest to read. | [#409](https://github.com/qwts/photos/issues/409) |
| 8 | **Targets below 24×24** — "New album" is **13×13**; tile select 18×18; list-row select 16×16. None qualify for the spacing exception. | [#415](https://github.com/qwts/photos/issues/415) |
| 9 | **`nested-interactive`** — tiles/rows are `role="button"` divs containing a real `<button>`; ARIA makes those children presentational, so the select control's name and pressed state may be discarded. They also handle **Enter but not Space**. | [#412](https://github.com/qwts/photos/issues/412) |
| 10 | **`Dialog` never restores focus on close.** Closing drops focus to `<body>`. Every dialog inherits it; `Shell` and `Sidebar` hand-patch around it per-site, which is the tell. **One fix in the primitive deletes the workarounds.** | [#399](https://github.com/qwts/photos/issues/399) |
| 11 | **Nothing hides the background from AT when a modal is open.** The Tab trap holds, but virtual-cursor/browse-mode users can still read and activate the entire app behind the scrim. The counterpart to the trap that already exists. | [#399](https://github.com/qwts/photos/issues/399) |
| 12 | **Live regions ~60% covered and inconsistent.** Missing on: StatusBar sync state, Inspector content swap, Import/Export progress, selection count, empty states, SD-card detection, the Lightbox custody strip. Present and correct on LockScreen, Ceremony, Offload, Interop. | [#400](https://github.com/qwts/photos/issues/400) |
| 13 | **`aria-label` on `<div>`s with no role** — silently ignored by AT. `LightboxViewport` zoom group, `InteropWorkflowDialog` transfer toggle, `ProtectedAlbumCeremony` password meter. Good intent, zero effect. axe catches only the third (`aria-prohibited-attr`). | [#400](https://github.com/qwts/photos/issues/400) |
| 14 | **SC 2.1.4 Character Key Shortcuts (Level A)** — `i`, `+`, `-`, `0` are unmodified single-key shortcuts on `window`: not remappable, not disableable, not focus-scoped. The `inField` guard checks only `input, textarea` — not `[contenteditable]`, `select`, or `role="textbox"`, and the two guards in the codebase disagree with each other. | [#399](https://github.com/qwts/photos/issues/399) |

### S3 — moderate

| # | Finding | Owner |
| --- | --- | --- |
| 15 | **No landmark for the Toolbar and no skip link** (2.4.1). `<main>`/`<nav>`/`<aside>`/`<header>`/`<footer>` exist; the Toolbar is in none of them. | [#400](https://github.com/qwts/photos/issues/400) |
| 16 | **Section headings are `<div>`s** — Sidebar (`Library`/`Albums`/`Protected`), Inspector (`Badges`/`Capture`/`File`/`Backup`). No heading outline; `SettingsDialog`'s `<h3>` has no `h1`/`h2` above it. | [#400](https://github.com/qwts/photos/issues/400) |
| 17 | **Visible label ≠ accessible name (2.5.3)**, systemically — via `Field.tsx` (used by every settings pane), `KeyDialog`'s label divs, `ExportDialog`'s row spans, and `ProtectedAlbumCeremony`, where a wrapping `<label>` is *overridden* by the field's own `aria-label`. | [#400](https://github.com/qwts/photos/issues/400) |
| 18 | **State conveyed by colour alone (1.4.1)** — `IconButton`'s `active` has no `aria-pressed`, so every stuck-on state (inspector open, filter active, favorite) is colour-only. Both password strength meters likewise. | [#400](https://github.com/qwts/photos/issues/400) · [#401](https://github.com/qwts/photos/issues/401) |
| 19 | **`Tooltip` has no `aria-describedby`** — `role="tooltip"` alone is inert and never read. No Escape-to-dismiss and no hoverable bubble: **1.4.13** fails on two of three. | [#400](https://github.com/qwts/photos/issues/400) |
| 20 | **`MetadataRow` renders unassociated label/value spans** — should be `<dl>/<dt>/<dd>`. Affects every metadata row in the Inspector. | [#400](https://github.com/qwts/photos/issues/400) |
| 21 | **`SettingsDialog` nav is a tab pattern built from buttons** — no `role="tablist"`/`tab`/`tabpanel`, no arrow keys, no `aria-controls`. `Segmented.tsx` is the correct in-repo reference. | [#399](https://github.com/qwts/photos/issues/399) · [#400](https://github.com/qwts/photos/issues/400) |
| 22 | **`SelectionPill`'s `role="menu"` is not a menu** — no focus management, no arrow keys, no Escape, no restore; trigger lacks `aria-haspopup`/`aria-expanded`. Same for `PhotoContextMenu`'s missing restore. | [#399](https://github.com/qwts/photos/issues/399) |
| 23 | **`anyDialogOpen` tracks 3 of ~11 dialogs.** With an Offload/Key/Interop/Protected dialog open, `i` toggles the inspector behind it and ⌘A selects the library underneath. `LightboxViewport` solves this generically; `use-global-keys` does not. | [#399](https://github.com/qwts/photos/issues/399) |
| 24 | **`⌘K` is advertised but not implemented** — `SearchField` renders the hint app-wide; no handler exists. A false affordance. | [#399](https://github.com/qwts/photos/issues/399) |
| 25 | **`prefers-reduced-motion` is only partially honoured** (3 usages) — the `syncing` spin and the Lightbox chrome fade are unguarded (2.3.3 / 2.2.2). | [#401](https://github.com/qwts/photos/issues/401) |
| 26 | **LockScreen's throttle countdown re-renders the submit button's name ~4×/sec**, so AT re-announces the focused button continuously (4.1.3). | [#400](https://github.com/qwts/photos/issues/400) |
| 27 | **All-caps literal strings in `.mono-data`** — some AT spells all-caps letter-by-letter. Prefer `text-transform: uppercase` over uppercase content strings. Coordinates with i18n [#382](https://github.com/qwts/photos/issues/382). | [#400](https://github.com/qwts/photos/issues/400) |

## Accepted exceptions

| Finding | Rationale |
| --- | --- |
| **LockScreen throttle is a timed restriction with no adjustment** (2.2.1) | Accepted under 2.2.1's **Essential** exception: the delay *is* the brute-force control, and making it adjustable would defeat it. The countdown must still be announced non-continuously — that part is finding 26, not an exception. |
| **`Switch checked disabled` for "Encrypt originals (always on)"** (ImportDialog) | Accepted. The label states the reason, and encryption is an invariant, not a preference (ADR-0004). `aria-disabled` + an explanation would be marginally better and is not worth a blocking issue. |
| **`alt` text is the filename, not a description** (1.1.1) | Accepted for now. No descriptions exist in the data model, and a filename is more useful than an empty string for a photo manager. Revisit if/when captions land. |
| **Zoom controls hidden with `visibility: hidden` in list mode** | Not a finding. `visibility: hidden` correctly removes them from both the a11y tree and the Tab order. Recorded so it is not re-reported. |
| **`Dialog`'s Escape starves `use-global-keys`** | Not a finding. `Dialog` listens on `document` and calls `stopPropagation`; `use-global-keys` listens on `window`, so the document listener wins. Verified. Recorded so the two mechanisms are not "fixed" into conflict. |
| **`PasswordField` blocks copy/cut** (3.3.8 Accessible Authentication) | **Not a finding — verified.** `onCopy`/`onCut` are prevented but **`onPaste` is not**, so password managers and paste-based entry work. 3.3.8 passes. Recorded because it looks like a failure on a quick read. |
| **`region` / `page-has-heading-one`** | Out of automated scope by design: both are axe **best-practice** rules, not WCAG AA, and the budget pins the AA tag set. The underlying gaps are still tracked as findings 15 and 16 against 1.3.1/2.4.1. |

## What the automation cannot see

Recorded so the gate is not mistaken for proof of accessibility.

- **The story lane mounts components in isolation.** Landmark uniqueness, focus order
  across regions, an overlay leaving the shell in the a11y tree, and live regions
  colliding do not exist until the app composes them — hence the E2E lane.
- **Neither lane can judge whether a flow is *completable*.** Announcement order, whether
  a live region fires at a useful moment, and whether the grid is navigable in practice
  are what the [VoiceOver script](Manual-Test-A11y-VoiceOver) is for.
- **axe's contrast check cannot see text over photos** — the Lightbox chrome and tile
  overlays sit on user content of unknown luminance. Manual, per finding 25's sibling work
  in [#401](https://github.com/qwts/photos/issues/401).
- **`target-size` and other 2.2-era rules only run because the tag set asks for them.**
  They are not in axe's defaults.

## Strengths worth preserving

Frame remediation as "apply the pattern already here", not "invent one":

- **`Dialog.tsx`** — focus trap with a disabled-aware selector, a `dialogStack` so only the
  topmost modal owns Escape/Tab, and `onClose` read through a ref. Missing only restore.
- **`Segmented.tsx`** — `role="radiogroup"` + roving `tabIndex` + arrow keys that skip
  disabled options. The reference for findings 21 and 13.
- **`IconButton.tsx`** — `label` required and `Omit<…, 'aria-label'>` makes it
  un-bypassable. The model for [#410](https://github.com/qwts/photos/issues/410).
- **`Icon.tsx`** — `aria-hidden` on every glyph by construction.
- **`LockScreen.tsx`** — `<form>` + `<h1>` + an always-present, initially-empty
  `role="status"`. The correct live-region technique; `Toast.tsx` should copy it.
- **`Sidebar.tsx`** — Shift+F10 / ContextMenu key, and focus restore that falls back when
  the opener row is destroyed.
- **`OffloadDialog`** (`<ul>`), **`InteropWorkflowDialog`** (`<dl>`, `<fieldset>`/
  `<legend>`, `htmlFor`) — the only correct instances of each; generalise them.

## Keyboard infrastructure review (seeds #399)

`src/renderer/src/state/use-global-keys.ts` is 41 lines: one `window` `keydown` listener,
a flat if-chain, no registry.

| Key | Action | Guards |
| --- | --- | --- |
| `⌘/Ctrl+A` | select all **loaded** photos | not in field, no tracked dialog |
| `Escape` | exit lightbox, else clear selection | no tracked dialog |
| `i` | toggle inspector | not in field, no tracked dialog |
| `←` / `→` | step lightbox ±1, wrapping | lightbox open |

`+`/`-`/`0` (zoom) are registered **separately** in `LightboxViewport.tsx` with a
*different, inconsistent* guard.

Limitations for #399 to absorb: no registry or discoverability surface (no shortcuts
help; ⌘A and the zoom keys are documented nowhere in the UI); 2.1.4 failure (finding 14);
`anyDialogOpen` tracks 3 of ~11 dialogs (finding 23); no arrow navigation, Home/End,
Space-to-select, or range selection in the grid; no focus awareness; not remappable; the
listener re-subscribes on every `state.photos` change. Also: **⌘A selects only the loaded
page, not the library** — "select all" is a lie at scale (3.2.4-adjacent, worth carrying).

## Method

- axe-core 4.12.1, pinned exact and overridden into `axe-playwright`'s floating
  `^4.10.1`: its rule set *defines* every count here, so it must not drift silently.
  A bump is expected to move numbers — re-audit in that PR.
- Story lane scopes to `#storybook-root`, so Storybook's own chrome never enters the budget.
- E2E flows: `shell-grid`, `shell-lightbox`, `shell-inspector`, `shell-settings-dialog`,
  `shell-selection`, on the deterministic seeded profile.
- Manual pass: full source audit of all renderer surfaces against the 2.2 AA criteria axe
  does not implement, plus verification of each "needs checking" item against the CSS.
