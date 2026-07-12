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

| Script                 | Purpose                                  |
| ---------------------- | ---------------------------------------- |
| `npm run typecheck`    | Type-check the codebase (`tsc --noEmit`) |
| `npm run format`       | Format all files with Prettier           |
| `npm run format:check` | Fail on formatting violations (CI gate)  |
