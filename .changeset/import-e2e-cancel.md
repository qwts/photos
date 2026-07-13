---
'photos': minor
---

Import flow closed out (#90): the full path is proven end-to-end in CI —
fixture card in (via the `OVERLOOK_IMPORT_SOURCE` harness seam), encrypted
library out, with no plaintext fixture bytes anywhere in the profile and
Move sources emptied only after per-file verification. The running dialog
gains a real Cancel (`import:cancel`): the engine finishes the file in
flight, keeps everything completed, finalizes the remainder as cancelled
(sources untouched), and reports exact counts.
