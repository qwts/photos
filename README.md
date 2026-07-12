# photos

A photo library app.

> Project description placeholder — expanded as feature work lands.

## Local development

Requires the Node version pinned in [`.nvmrc`](.nvmrc) (`nvm use` picks it up).

```sh
nvm use
npm ci
```

### Scripts

| Script                     | Purpose                                              |
| -------------------------- | ---------------------------------------------------- |
| `npm run typecheck`        | Type-check the codebase (`tsc --noEmit`)             |
| `npm run lint`             | ESLint + cycles + dead code + type coverage          |
| `npm run lint:cycles`      | madge — zero circular imports in `src/`              |
| `npm run lint:dead`        | knip — dead code, unused exports/dependencies        |
| `npm run lint:types`       | type-coverage floor (`--at-least 99.8 --strict`)     |
| `npm run format`           | Format all files with Prettier                       |
| `npm run format:check`     | Fail on formatting violations (CI gate)              |
| `npm run test`             | Typecheck, compile tests, run `node --test`          |
| `npm run test:cov`         | `test` under c8 with the `.c8rc.json` coverage floor |
| `npm run coverage:summary` | Render c8 totals vs. floor (CI step summary)         |

## Testing

Unit tests live in `tests/` and run against compiled JS (image-trail's compile-then-run model:
`tsconfig.test.json` emits `src/` + `tests/` to `.test-dist/`, then `node --test` runs the
output — no loader magic). Coverage floors in `.c8rc.json` ratchet **upward only**.

When UI code appears, add the DOM lane the same way image-trail does: a happy-dom global
registrator imported via `node --import`, DOM tests under `tests/dom/`, and `test:dom` /
`test:dom:run` scripts chained into `test` and `test:cov`. Not built until there is DOM code
to test.
