# M03: Encrypted library core

**Epic:** [#38](https://github.com/qwts/photos/issues/38) · **Lane:** Lane B — Core

Lane B. The privacy foundation the whole app sits on: a local SQLite library plus an on-disk **encrypted blob store** for originals and thumbnails — AES-256-GCM with versioned keys (the design's Inspector shows "AES-256-GCM · KEY #2"), master key held in the OS keychain via Electron safeStorage. Encryption is **always on** ("Cannot be disabled" — Settings/Storage in the design). Exposed to the renderer only through the typed IPC layer from M01.

## Issues

| #                                               | Title                                                                   | Blocked by |
| ----------------------------------------------- | ----------------------------------------------------------------------- | ---------- |
| [#65](https://github.com/qwts/photos/issues/65) | ADR-0004: encryption & key management                                   | —          |
| [#66](https://github.com/qwts/photos/issues/66) | ADR-0005: library data model & on-disk layout                           | —          |
| [#67](https://github.com/qwts/photos/issues/67) | Crypto engine: streaming AES-256-GCM with versioned keys                | #65, #49   |
| [#68](https://github.com/qwts/photos/issues/68) | Master-key lifecycle: keychain custody, key metadata, rotation scaffold | #65, #49   |
| [#69](https://github.com/qwts/photos/issues/69) | SQLite module: better-sqlite3, migrations runner, schema v1             | #66, #49   |
| [#70](https://github.com/qwts/photos/issues/70) | Encrypted blob store: originals + thumbnails with integrity checksums   | #66, #67   |
| [#71](https://github.com/qwts/photos/issues/71) | Library IPC service: paged queries, mutations, counts                   | #69, #70   |
| [#72](https://github.com/qwts/photos/issues/72) | Dev-seed fixture library for development and E2E                        | #71        |

## Definition of done

See the epic issue [#38](https://github.com/qwts/photos/issues/38) — the epic body is canonical; this page is the planning index entry.
