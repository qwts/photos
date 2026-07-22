---
'photos': patch
---

Verify the Moodboard view end to end and fix a rendering bug it caught (part of
#515). A new Electron E2E confirms the view renders in the real app and a
board's layout survives an app restart byte-stably (invariant I2), and a
scale/perf test exercises the board domain at 250 placements (correctness at
scale plus a generous hot-path budget). The E2E surfaced that the canvas
collapsed to zero height inside the shell's (non-flex) content area — it now
fills that area the way the grid does, so the Moodboard is visible in the app,
not only in isolated stories.
