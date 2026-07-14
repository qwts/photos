# photos

Overlook — a privacy-first desktop photo library app (Electron + React 18 + Vite;
see the wiki [ADR-0003](https://github.com/qwts/photos/wiki/ADR-0003-Desktop-Stack)).

<img width="1296" alt="ImageOverlook" src="https://github.com/user-attachments/assets/07ad9814-ebac-4da8-b408-459110ae55fa"/>


## Local development

Requires the Node version pinned in [`.nvmrc`](.nvmrc) (`nvm use` picks it up).

```sh
nvm use
npm ci
npm run dev   # opens the Electron window with renderer HMR
```

### Scripts

| Script                     | Purpose                                                         |
| -------------------------- | --------------------------------------------------------------- |
| `npm run dev`              | Electron with HMR renderer + main relaunch (`electron-vite`)    |
| `npm run typecheck`        | Type-check all processes (root + main/preload/renderer)         |
| `npm run lint`             | Pins + file sizes + ESLint + cycles + dead code + type coverage |
| `npm run lint:package`     | Exact version pins in package.json (no ranges)                  |
| `npm run lint:new-files`   | 800-line budget for files new on the branch                     |
| `npm run lint:cycles`      | madge — zero circular imports in `src/`                         |
| `npm run lint:dead`        | knip — dead code, unused exports/dependencies                   |
| `npm run lint:types`       | type-coverage floor (`--at-least 99.8 --strict`)                |
| `npm run format`           | Format all files with Prettier                                  |
| `npm run format:check`     | Fail on formatting violations (CI gate)                         |
| `npm run test`             | Typecheck, compile tests, run `node --test`                     |
| `npm run test:cov`         | `test` under c8 with the `.c8rc.json` coverage floor            |
| `npm run coverage:summary` | Render c8 totals vs. floor (CI step summary)                    |
| `npm run build`            | Bundle main/preload/renderer to `out/` (`electron-vite build`)  |
| `npm run ci`               | Full local gate suite — mirrors the CI workflow                 |
| `npm run test:e2e`         | Playwright E2E (builds app via global-setup)                    |

## Testing

Unit tests live in `tests/` and run against compiled JS (image-trail's compile-then-run model:
`tsconfig.test.json` emits `src/` + `tests/` to `.test-dist/`, then `node --test` runs the
output — no loader magic). Coverage floors in `.c8rc.json` ratchet **upward only**.

When UI code appears, add the DOM lane the same way image-trail does: a happy-dom global
registrator imported via `node --import`, DOM tests under `tests/dom/`, and `test:dom` /
`test:dom:run` scripts chained into `test` and `test:cov`. Not built until there is DOM code
to test.
