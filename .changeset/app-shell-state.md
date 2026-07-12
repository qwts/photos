---
'overlook-photos': minor
---

App state store and composition shell: a pure reducer holds the mock's app
state (query, zoom, view, source, chips, selection, lightbox, inspector,
dialogs, toast, pending count), provided to the renderer via context with IPC
push events dispatching into it. The app now boots into the composed chrome —
title bar, toolbar region, sidebar with live source counts, content region,
optional inspector, and status bar — with global keys (⌘/Ctrl+A, Esc, `i`)
wired through the reducer.
