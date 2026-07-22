---
'photos': minor
---

Persist moodboards in the encrypted library (part of #515). Boards are now
stored as album-class organizational metadata inside the whole-DB SQLCipher
`library.db` (migration 18): board-level fields in columns, the ordered
placement list as canonical byte-stable JSON. The Moodboard view loads its
board on open and saves layout changes back (debounced) over new zod-validated
`board:*` IPC channels, so a board survives app restart and library switch — a
switch reloads the renderer against the newly activated library, restoring the
exact layout (invariant I2). Placements are references with no photo foreign
key, so deleting a photo leaves an honest "unavailable" placement rather than
cascading the layout away. Backup/restore inclusion of boards lands in a
follow-up slice.
