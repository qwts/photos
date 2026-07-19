# M01: Desktop shell

**Epic:** [#36](https://github.com/qwts/photos/issues/36) · **Lane:** Foundation (gates all)

The foundation epic (#1) gave qwts/photos its full CI/tooling stack. This epic turns the repo into a desktop app: **Overlook**, a privacy-first photos app specified by the design handoff at `design_handoff_overlook_desktop_app/` (see `HANDOFF_TO_CLAUDE_CODE.md` + `README.md` — the spec). Stack decision (with the owner): **Electron + React 18 + Vite** — single TypeScript toolchain, first-class native modules (better-sqlite3, sharp), Playwright-Electron E2E. Ratified as ADR-0003 in the first sub-issue.

## Issues

| #                                               | Title                                                                    | Blocked by |
| ----------------------------------------------- | ------------------------------------------------------------------------ | ---------- |
| [#47](https://github.com/qwts/photos/issues/47) | ADR-0003: desktop stack — Electron + React 18 + Vite                     | —          |
| [#48](https://github.com/qwts/photos/issues/48) | Electron scaffold: main/preload/renderer processes with Vite             | #47        |
| [#49](https://github.com/qwts/photos/issues/49) | Typed IPC contract layer (contextBridge, schema-validated channels)      | #48        |
| [#50](https://github.com/qwts/photos/issues/50) | Frameless window: mac hiddenInset / win custom window controls           | #48        |
| [#51](https://github.com/qwts/photos/issues/51) | Gate integration: full lint/test/coverage suite over the Electron layout | #48        |
| [#52](https://github.com/qwts/photos/issues/52) | Playwright-Electron E2E smoke (retire the http-server fixture lane)      | #48        |
| [#53](https://github.com/qwts/photos/issues/53) | electron-builder: unsigned dev packaging for mac and win                 | #48        |

## Definition of done

See the epic issue [#36](https://github.com/qwts/photos/issues/36) — the epic body is canonical; this page is the planning index entry.
