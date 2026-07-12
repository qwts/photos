---
'photos': minor
---

Typed IPC contract layer: all renderer↔main traffic rides a zod-validated
channel/event registry (`src/shared/ipc`); the renderer sees only the typed
`window.overlook` surface, malformed traffic rejects at the boundary, and a
main→renderer event pattern (window focus demo) is in place for progress and
settings pushes.
