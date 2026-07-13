# M06: Lightbox & Inspector

**Epic:** [#41](https://github.com/qwts/photos/issues/41) · **Lane:** Lane A — UI

Lane A. Full-window single-photo viewing with decrypt-to-view delivery (memory-only, LRU-capped — plaintext never touches disk), the auto-hiding chrome the design specifies (fade in on mouse move, hide after ~2.2s), ←/→ navigation with wraparound, Esc dual semantics (clear selection vs. exit lightbox), `i` toggling the 280px right-docked Inspector with grouped MetadataRows (file / camera / backup — "ENCRYPTED · PCLOUD · 2H AGO", "AES-256-GCM · KEY #2").

## Issues

| # | Title | Blocked by |
| --- | --- | --- |
| [#91](https://github.com/qwts/photos/issues/91) | Full-resolution decrypt-to-view delivery (memory-only, LRU) | #67, #70 |
| [#92](https://github.com/qwts/photos/issues/92) | Lightbox: full-window view with auto-hiding chrome | #76, #91 |
| [#93](https://github.com/qwts/photos/issues/93) | Lightbox keyboard: ←/→ navigation, Esc dual semantics, i for inspector | #92 |
| [#94](https://github.com/qwts/photos/issues/94) | Inspector: grouped metadata panel | #92, #62 |
| [#95](https://github.com/qwts/photos/issues/95) | Lightbox mutations: favorite/delete dirty the backup ledger | #92 |
| [#96](https://github.com/qwts/photos/issues/96) | E2E: grid → lightbox → inspector acceptance flow | #93, #94, #95 |

## Acceptance coverage

| Flow | Status | Coverage |
| --- | --- | --- |
| Full-res delivery: memory-only decrypt over `overlook-full://`, `no-store` (no disk-cache plaintext), RAW preview-marked (`X-Overlook-Preview: 1`), bounded LRU budget, `?prefetch=1` neighbor warm, rapid-paging cancellation | ✅ #91 (PR #179) | `tests/e2e/fullres.spec.ts` (incl. whole-profile plaintext scan) + `tests/fullres/full-service.test.ts` — ledger id `m06-full-res-delivery` |
| Lightbox open + auto-hiding chrome (2.2s, wake on move/photo change) | ✅ #92 (PR #187) | `Lightbox.stories.tsx` play tests + `tests/e2e/lightbox.spec.ts` — ledger id `m04-lightbox-open` |
| Keyboard: ←/→ wraparound, Esc dual semantics, i for inspector | ✅ #93 (PR #188) | `tests/e2e/lightbox.spec.ts` + reducer tests — ledger id `m06-lightbox-keyboard` |
| Inspector truth panel (real EXIF/key metadata, never-fabricate) | ✅ #94 (PR #190) | `Inspector.stories.tsx` + e2e — ledger id `m06-inspector` |
| Mutations: favorite → tile star + pendingCount + StatusBar, no reload | ✅ #95 (PR #191) | e2e — ledger id `m06-lightbox-mutations` |
| Viewing-journey acceptance (selection through Esc, autohide in CI) | ✅ #96 (PR #192) | `tests/e2e/lightbox.spec.ts` |

Notable: the #96 acceptance E2E caught a real bug — Chromium's synthetic mousemove on our own pointer-events flip kept re-waking the chrome; stationary events are now ignored (patch changeset).

## Definition of done

See the epic issue [#41](https://github.com/qwts/photos/issues/41) — the epic body is canonical; this page is the planning index entry.
