---
'photos': patch
---

Relocation fixes from PR #553 review: a successful active-library move now rebinds the runtime to the destination (same-id select refreshes the cached registry entry instead of serving the stale source path), and moving an app-locked library no longer fails verification — the staged-custody probe recognizes ADR-0013 OVLK custody and skips the passwordless open probe, relying on the byte-digest verification that already proved the copy identical.
