# ADR-0002: Versioning Policy

## Status

Accepted

## Context

photos needs a versioning policy **before the first feature PR** so every
behavior-changing change is classified and changelogged from the start
(epic [#1](https://github.com/qwts/photos/issues/1), issue
[#18](https://github.com/qwts/photos/issues/18)). The package is private with
no release target yet; versions exist to communicate change magnitude and feed
the changelog, not to publish.

## Decision

**Semver via [changesets](https://github.com/changesets/changesets), with
explicit 0.x semantics while the public surface is still forming:**

- **Pre-1.0 (`0.x.y`):**
  - **minor** (`0.x` bump) — any behavior-changing or breaking change: new
    user-facing capability, changed defaults, removed/renamed surface, storage
    or data-model changes requiring migration.
  - **patch** (`0.0.y` bump) — bug fixes, internal refactors, performance work,
    and dependency bumps with no observable behavior change.
  - Breaking changes are **allowed in minors pre-1.0** — that is what 0.x
    signals — but each must be called out in its changeset text.
- **1.0 condition:** cut `1.0.0` when photos has a usable core (import, browse,
  organize) whose data model and primary UI surface we are prepared to keep
  stable — i.e. when a breaking change would genuinely inconvenience users.
  From then on, standard semver: breaking = major.
- **Changeset convention:** behavior-changing PRs include a changeset
  (`npx changeset`); docs/tooling-only PRs may skip it. **No CI hard-gate**
  (image-trail's default) — the PR template prompts for it; revisit a gate if
  changesets get forgotten in practice.
- `npm run changeset:version` consumes pending changesets into `CHANGELOG.md`
  and bumps `package.json`. If photos ever grows a second version-bearing file
  (a manifest, an about screen), sync it in the same script (image-trail's
  `sync-manifest-version.mjs` pattern) rather than by hand.

## Consequences

- Change magnitude is recorded at PR time by the author who knows it best, not
  reconstructed at release time.
- `CHANGELOG.md` is generated — never hand-edited.
- The version number carries meaning from the first feature PR, making the 1.0
  decision an explicit product call rather than an accident.
- Until a release target exists there is no publish step; `changeset version`
  runs on demand when we want to cut a changelog entry batch.
