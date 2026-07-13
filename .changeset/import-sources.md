---
'photos': minor
---

Import is no longer SD-only: the Import dialog gains a source picker — SD card (with a "no card detected" empty state), Local folder (OS picker, scans subfolders), and Dropped (drag photo files anywhere onto the window for a full-window drop overlay that opens the dialog pre-seeded). Move remains exclusive to SD cards: folder and dropped imports force Copy in the UI and the pipeline rejects Move for non-volume sources, so the app never deletes a user's own files. Non-photo drops get a "nothing to import" toast.
