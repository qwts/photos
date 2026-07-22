---
'photos': minor
---

Undo/redo for moodboard layout edits through the shared activity history (part
of #515, ADR-0024/0025). Each committed gesture (the canvas coalesces a gesture
into one debounced save) records a single undoable `board.layout` command whose
inverse is the canonical before/after board, so ⌘Z reverts one gesture at a
time and ⌘⇧Z re-applies it — capability-checked and idempotent like every other
undoable command. Undo/redo rewrites the board in the main process and pushes a
`board:reload` event so the open canvas reflects the reverted layout instead of
overwriting it. Board layout changes now appear in the Activity log.
