---
'photos': minor
---

Electron desktop shell scaffold: `npm run dev` opens a window rendering the
React shell placeholder. Main/preload/renderer processes exist with security
defaults (no nodeIntegration, contextIsolation, sandboxed renderer);
`npm run build` now produces the app bundle in `out/` via electron-vite.
