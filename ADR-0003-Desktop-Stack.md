# ADR-0003: Desktop Stack

## Status

Accepted

## Context

photos is becoming **Overlook**, a privacy-first desktop photos app specified by
the design handoff at `design_handoff_overlook_desktop_app/`
(epic [#36](https://github.com/qwts/photos/issues/36), issue
[#47](https://github.com/qwts/photos/issues/47)). The handoff brief targets "an
Electron or Tauri desktop shell with a local encrypted SQLite library + pCloud
backup" and leaves the choice to the implementation. Every M01+ issue builds on
the shell, so the stack must be ratified before the first scaffold PR.

Forces:

- The repo already has a full TypeScript gate suite (lint chain, c8 coverage
  floors, type-coverage, 800-line budget, Playwright E2E lane —
  [ADR-0001](ADR-0001-Automation-Check-Governance)). The stack should extend
  that suite, not add a second toolchain beside it.
- The product core needs native modules: an encrypted local SQLite library
  (better-sqlite3) and image/thumbnail processing (sharp).
- The design assumes a frameless window with a custom 30px `TitleBar` and full
  control of window chrome.
- The team is one owner plus coding agents; operational simplicity outweighs
  runtime footprint.

## Decision

**We will build the desktop shell with Electron + React 18 + Vite** (rather
than Tauri), decided with the owner in issue
[#47](https://github.com/qwts/photos/issues/47).

Drivers:

- **Single TypeScript toolchain.** Electron's main, preload, and renderer
  processes are all TypeScript, so the existing gates (ESLint chain, c8 floors,
  type-coverage, file budget) cover the whole app. Tauri would add a Rust
  toolchain, a second linter/test stack, and a gate suite the current
  automation does not govern.
- **First-class native modules.** better-sqlite3 and sharp are mature,
  prebuilt-binary npm packages in Electron's Node runtime. The Tauri
  equivalents would mean Rust crates plus an IPC bridge for every library
  operation.
- **Playwright's Electron target.** The existing E2E lane is Playwright;
  `playwright._electron` drives the real app with the same runner, config, and
  reporting. Tauri has no Playwright driver — E2E would move to WebDriver.
- **Design assumptions.** The handoff's frameless-window/TitleBar chrome maps
  directly onto Electron's `frame: false` + `-webkit-app-region` model that the
  mock was written against.

React 18 (not 19) because the design mock's JSX targets it and the ecosystem
pins (testing-library, Playwright component patterns) are stable there; Vite
because it is the de-facto Electron + React dev loop (`electron-vite`) with HMR
for the renderer.

## Consequences

- Scaffold ([#48](https://github.com/qwts/photos/issues/48)) and everything
  after it build on `src/main/` / `src/preload/` / `src/renderer/` with
  Electron security defaults (`nodeIntegration: false`,
  `contextIsolation: true`, `sandbox: true`) — the typed IPC layer
  ([#49](https://github.com/qwts/photos/issues/49)) is the only main↔renderer
  channel.
- **Costs accepted:** installers and memory footprint are substantially larger
  than Tauri's (bundled Chromium vs the OS webview); Electron's Chromium
  update cadence means regular major bumps that Dependabot will surface and we
  must take promptly for security fixes; native modules (better-sqlite3,
  sharp) must match the Electron ABI, so Electron bumps can force lockstep
  native-module rebuilds under the exact-pin policy.
- **Open native-module policy question → ADR-0006 (media processing,
  [#83](https://github.com/qwts/photos/issues/83)):** whether native modules
  load in the main process or a utility process, how ABI mismatches are caught
  in CI (`electron-rebuild` vs prebuilt binaries), and how sharp/better-sqlite3
  versions are held in lockstep with Electron under exact pins. ADR-0006 must
  settle this before the media pipeline lands.
- Revisit if the app's footprint becomes a user-facing problem or Tauri gains
  a Playwright driver and first-class Node-native-module story; a switch would
  be a new ADR superseding this one.
