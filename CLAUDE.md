# photos — Claude Code guide

Start with **`AGENTS.md`**. It is the shared agent-context file and holds the
communication rules, pre-edit checkpoints, working agreement (draft PR first,
frequent commits, end-of-turn status footer), GitHub hygiene, and validation
workflow. This file only adds Claude-specific orientation; do not duplicate
`AGENTS.md` here.

## Architecture

No layering yet — `src/` holds a single trivial module until feature work
begins. When layers exist, record the import-direction rules here and enforce
them with `no-restricted-imports` in `eslint.config.js` (image-trail's pattern).

## Before "done"

```sh
npm run ci        # lint chain, format:check, test:cov (coverage floor), build
npm run test:e2e  # additionally, for E2E-relevant changes
```

The `/check` command wraps this and reports each gate explicitly. Floors
(c8 lines 90 / branches 80, type-coverage 99.8, 800-line file budget) are
ratchets — only ever raise them.
