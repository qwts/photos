# photos — Claude Code guide

Start with **`AGENTS.md`**. It is the shared agent-context file and holds the
communication rules, pre-edit checkpoints, working agreement (draft PR first,
frequent commits, end-of-turn status footer), GitHub hygiene, and validation
workflow. This file only adds Claude-specific orientation; do not duplicate
`AGENTS.md` here.

## Architecture

Electron process layout (ADR-0003), enforced with `no-restricted-imports` in
`eslint.config.js`:

- `src/main/` — main process (lifecycle, windows, IPC handlers). May import
  `src/shared/`, never `src/renderer/`.
- `src/preload/` — contextBridge only; builds the typed `window.overlook`
  surface. May import `src/shared/`, never `src/main/`.
- `src/renderer/` — sandboxed React app. May import `src/shared/` (types +
  pure logic), never `src/main/` or `src/preload/`.
- `src/shared/` — pure, process-free modules (IPC contract registry in
  `shared/ipc/`, domain logic). Imports nothing process-specific.

All renderer↔main traffic goes through the zod-validated channel/event
registry in `src/shared/ipc/channels.ts` (#49) — never raw `ipcRenderer`.

## Before "done"

```sh
npm run ci        # lint chain, format:check, test:cov (coverage floor), build
npm run test:e2e  # additionally, for E2E-relevant changes
```

The `/check` command wraps this and reports each gate explicitly. Floors
(c8 lines 90 / branches 80, type-coverage 99.8, 800-line file budget) are
ratchets — only ever raise them.
