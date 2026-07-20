# Keyboard Commands

Overlook's keyboard commands come from the shared registry in
`src/shared/commands/registry.ts`. The `?` overlay is generated from that
registry and shows only commands active in the current surface.

## Library

| Action                   | Shortcut     |
| ------------------------ | ------------ |
| Focus search             | `Cmd/Ctrl+K` |
| Select all loaded photos | `Cmd/Ctrl+A` |
| Clear selection          | `Esc`        |
| Show or hide Inspector   | `I`          |
| Show keyboard shortcuts  | `?`          |

Photo focus is roving: only one tile is in the Tab order. Arrow keys move by
cell or row, Home/End move to the row boundary, and Page Up/Page Down move by a
viewport. Shift plus a movement key extends the selection; Space toggles the
focused photo; Enter opens it. The skip link moves directly to the grid.

## Lightbox

| Action                                | Shortcut         |
| ------------------------------------- | ---------------- |
| Previous / next photo                 | `Left` / `Right` |
| Exit lightbox                         | `Esc`            |
| Show or hide Inspector                | `I`              |
| Toggle favorite                       | `F`              |
| Move to Trash                         | `Delete`         |
| Zoom in / out / reset                 | `+` / `-` / `0`  |
| Rotate left / right                   | `[` / `]`        |
| Flip horizontally / reset orientation | `\\` / `R`       |

When a zoomed image overflows the viewport, arrow keys pan it before they
navigate between photos. Dialogs and editable controls always retain keyboard
precedence. Closing a dialog restores focus to its invoker.

## Adding a command

Give it a stable command ID, localized label, active surfaces, and one canonical
binding. Add any layout-equivalent character variants as alternate keys. The
registry conflict test must remain empty; do not copy shortcut strings into
menus, help, or feature components.
