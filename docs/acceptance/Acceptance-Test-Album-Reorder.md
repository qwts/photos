# Acceptance Test: Album reordering (sidebar) — #225

**Surface:** ordinary album rows in `src/renderer/src/shell/Sidebar.tsx`  
**Design of record:** `Album Reorder.html` from the #225 design-system package

## Contract

Ordinary albums are reorderable by a dedicated pointer handle in the expanded
sidebar, an APG-style keyboard grab model, Option+Up/Down, and the shared
`album.reorder.*` menu commands. The album row remains the photo-drop target;
reorder drags use `application/x-overlook-album-reorder`, so the gestures do not
conflict. Collapsed mode hides the handle but retains menu commands.

Persistence replaces the complete ordinary-album order atomically and stores
contiguous `0…n-1` positions. A committed move is one undoable command and owes
a new backup manifest even when every moved album is empty. No-op moves do not
enter history. Protected albums, active source, selection, and membership do not
change.

## Executable matrix

| Scenario                                        | Expected                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Focus handle, `Space`, arrow/Home/End, `Space`  | Preview moves; commit persists; focus stays on moved handle; polite position announcement |
| `Esc` while grabbed                             | Original order returns; cancellation announced                                            |
| First/last bound                                | Move command remains visible but disabled with an explicit reason                         |
| Option+Up/Down on album row                     | Uses the same shared reorder command path                                                 |
| Pointer drag from handle                        | Reorders ordinary albums; drag from row still performs photo membership drop              |
| Drop on same position or invalid sidebar region | No history record; order reverts                                                          |
| Collapsed sidebar                               | No handle; tooltip names album position; context menu still reorders                      |
| Undo/redo and reload                            | Complete prior/next order is restored atomically and survives restart                     |
| Album list changes during interaction           | Preview cancels and announces that the list changed                                       |
| RTL / reduced motion                            | Handle uses logical-leading placement; ordering stays logical; transitions are removed    |

## Automated evidence

- `tests/e2e/album-reorder.spec.ts`: keyboard commit, live announcement,
  collapsed-menu command, undo, and reload persistence.
- `src/renderer/src/shell/Sidebar.stories.tsx`: handle semantics, keyboard grab,
  collapsed rail, RTL, protected-row separation, and photo-drop coexistence.
- `tests/db/album-order.test.ts`: exact-set validation, atomic replacement, and
  contiguous positions.
- `tests/history/history-service.test.ts`: one-command undo/redo and manifest
  debt for empty-album order changes.
- `tests/library/album-reorder-drag.test.ts`: dedicated versioned drag payload.
