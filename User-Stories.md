# User Stories

Planning home for the Overlook milestone / user-story breakdown. Individual
stories are GitHub issues; each milestone below is an epic issue with
sub-issues and native blocked-by dependencies (see the epics themselves for
live progress).

The build implements the design handoff at
`design_handoff_overlook_desktop_app/` — see the repo's `HANDOFF_TO_CLAUDE_CODE.md`
and `README.md` there (the spec), plus ADRs 0003–0007 as they land.

## Milestone index

| Milestone | Title | Epic | Lane |
| --- | --- | --- | --- |
| [M01](User-Story-M01-Desktop-shell) | Desktop shell | [#36](https://github.com/qwts/photos/issues/36) | Foundation (gates all) |
| [M02](User-Story-M02-Design-system) | Design system | [#37](https://github.com/qwts/photos/issues/37) | Lane A — UI |
| [M03](User-Story-M03-Encrypted-library-core) | Encrypted library core | [#38](https://github.com/qwts/photos/issues/38) | Lane B — Core |
| [M04](User-Story-M04-Library-browsing) | Library browsing | [#39](https://github.com/qwts/photos/issues/39) | Join A+B |
| [M05](User-Story-M05-Import-pipeline) | Import pipeline | [#40](https://github.com/qwts/photos/issues/40) | Lane B — Core |
| [M06](User-Story-M06-Lightbox-Inspector) | Lightbox & Inspector | [#41](https://github.com/qwts/photos/issues/41) | Lane A — UI |
| [M07](User-Story-M07-Export) | Export | [#42](https://github.com/qwts/photos/issues/42) | Lane B — Core |
| [M08](User-Story-M08-Backup-offload-engine-provider-abstraction-mock-first) | Backup & offload engine (provider abstraction, mock-first) | [#43](https://github.com/qwts/photos/issues/43) | Lane B — Core (tail) |
| [M09](User-Story-M09-Settings-preferences) | Settings & preferences | [#44](https://github.com/qwts/photos/issues/44) | Lane C — Settings |
| [M10](User-Story-M10-Albums-organization-deletion) | Albums, organization & deletion | [#45](https://github.com/qwts/photos/issues/45) | Lane A — UI (tail) |
| [M11](User-Story-M11-Scale-hardening-release-readiness) | Scale, hardening & release readiness | [#46](https://github.com/qwts/photos/issues/46) | Closing |
| [M20](User-Story-M20-Privacy-lock-protected-albums) | Privacy lock, Touch ID & protected albums | [#305](https://github.com/qwts/photos/issues/305) | Lane B — Core with Lane A/C UI |

## Parallelism

After M01: **Lane A** (M02 → M04-UI → M06 → M10) runs parallel to **Lane B**
(M03 → M05 → M07 → M08), with **Lane C** (M09 settings store) starting early.
Critical path: M01 → M03 crypto/DB → M05 import engine → M08 backup/offload → M11.

New stories use the
[User Story template](https://github.com/qwts/photos/issues/new?template=user-story.md)
and the `user story` label; acceptance scenarios feed the testing lanes per the
[Testing Strategy](Testing-Strategy) — coverage travels with the change.
