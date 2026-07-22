---
'photos': minor
---

Remove the native application menu on Windows/Linux; add a titlebar Help menu
(#699, ADR-0024 §5 amendment). The native menu bar is a macOS-only design
surface, so `buildApplicationMenuTemplate` now returns an empty template on
win32/linux and the controller sets no application menu there. Every command
stays reachable through the existing toolbar, sidebar, titlebar, and keyboard
surfaces; the two otherwise menu-only Help commands (`help.activity`,
`help.open`) move to a new `TitlebarHelpMenu` — a no-drag `circle-help` button
left of the window controls that opens the shared APG `ContextMenu`, mirroring
the macOS Help menu (Keyboard Shortcuts, Activity…, Privacy & Diagnostics,
Overlook Help) from one shared `HELP_MENU_ITEMS` list so the two Help surfaces
cannot drift, and deletes the `otherApplicationMenuTemplate`. Activity stays a
Help affordance, never a sidebar row (#690). Both native command surfaces share
one executor — `useNativeCommandRouter` now returns its `runCommand` so the
titlebar menu dispatches the identical registry handlers as the macOS menu. A
narrow `help:open` IPC lets the renderer open external help, and `circle-help` /
`keyboard` join the icon vocabulary.
