# Overlook — Desktop App UI Kit

Interactive mock of the Overlook desktop app (Electron/Tauri shell). Open `index.html`.

What it demonstrates:
- **Library grid** — app opens straight into the full-bleed tile grid; zoom slider (96–320px tiles), hover select, multi-select action bar.
- **Lightbox** — click any tile: the photo takes over the window (chrome overlays fade in on hover); ← → arrows, Esc to return, `i` toggles the inspector.
- **Inspector** — EXIF/file/backup metadata for the focused photo.
- **Import flow** — toolbar Import button → dialog → simulated thumbnail-generation progress → toast.
- **Filters & search** — funnel toggles the chip row; search matches name/place/camera.
- **Sidebar** — library sources, reorderable ordinary albums, backup/storage card.
- **Export** — Export button in the selection bar and lightbox toolbar → dialog with format (Original/JPEG), a decrypt-originals toggle (on by default; required to get openable files out of the encrypted vault), destination, simulated progress.
- **Status bar** — library-wide counts, encryption state, sync activity in mono.
- **Settings** — gear icon on the sidebar's backup card → General / Storage & Backup / Privacy. Storage & Backup is where pCloud is connected/disconnected, auto-backup, copy-vs-move on import, Wi-Fi-only, and bandwidth limit live.

Files: `photos.js` (fake library data) · `Toolbar.jsx` · `Sidebar.jsx` · `LibraryGrid.jsx` · `Lightbox.jsx` · `Inspector.jsx` · `ImportDialog.jsx` · `ExportDialog.jsx` · `SettingsDialog.jsx` · `StatusBar.jsx` · `index.html` (app state + composition).

Not built (v1 scope): semantic search results UI.
