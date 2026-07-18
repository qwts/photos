# Agent Instructions

Repo-local agent orientation layer — the **shared agent-context file**; other
agent files (`CLAUDE.md`, `.github/copilot-instructions.md`) point here instead
of duplicating. Read `CONTRIBUTING.md` first, then the wiki contributor guide
it links: https://github.com/qwts/photos/wiki/Contributing

Keep this file compact; use references instead of duplicating long procedures.
Detailed workflow, SOP, and project documentation belong in the wiki.

**Maintenance convention:** when workflow, gates, or invariants change, update
this file in the same PR as the change — never after the fact.

## Communication

- Be brief: minimum words, bullets over paragraphs, no preamble, recap, or filler.
- Fix the problem; no sycophancy, apologies, or narrating past mistakes unless
  required for the fix.
- On correction: one-sentence restatement of updated requirements, then proceed.
- Disagree plainly when mistaken; cite code or docs.
- Do not narrate unsolicited intent or process, announce next steps, or confess
  partial completion. The pre-edit checkpoints in **Before Changing Code** are
  exempt — deliver those once, then implement without ongoing narration.
- Status updates belong in issue comments during issue work, not in chat unless
  the user asked for progress.

## Before Changing Code

- **New issue work:** investigate and root-cause (or confirm scope), then share a
  concise working note covering the problem, cause or scope, intended changes,
  assumptions, and likely tradeoffs. This keeps the user oriented; it is not an
  approval gate. Proceed from the user's stated goal, and surface only decisions
  that would materially change scope or risk.
- **Shared issue context:** add the same working note to the issue (issue comment
  per the wiki claim flow) so the user and other contributors can work from the
  same information.
- **During implementation:** post issue comments for each meaningful change
  slice: what changed and why.
- **Before editing:** state in one short line each: likely fix, why it may not
  work, confidence (low/medium/high), possible regressions. Then implement.

## Working Agreement

- **Open a PR early. A draft is optional — finishing it is not.** After claiming
  an issue and branching, push the branch and open a pull request. Opening it as
  a **draft** is welcome and encouraged when the first commit is scaffolding or a
  failing test; it makes work in flight visible. Opening it ready straight away is
  equally fine. Draft is a **starting state, never an ending state**.
- **Take the PR out of draft the moment the work is complete.** As soon as
  `npm run ci` passes locally (plus `test:e2e` / `test:stories:ci` where they
  apply), run `gh pr ready <n>`. Do not wait to be asked. **A draft PR is
  reviewed by nobody — not the owner, not the Codex bot — so a PR abandoned in
  draft is the same as never doing the work**: from the outside it is
  indistinguishable from abandoned work, and it hides the one signal the owner
  has that a slice is finished. Never end a session with your own PR still in
  draft — check `gh pr list --state open --json number,isDraft,title` before
  reporting completion. If something genuinely blocks ready-for-review, say so on
  the PR and in your summary and name the blocker; silence reads as abandonment.
  **"Ready for review" is the definition of done for a code slice** — "pushed"
  and "CI is green" are not. (Wiki-only work such as an ADR has no PR at all —
  precedent [#394](https://github.com/qwts/photos/issues/394) /
  [#402](https://github.com/qwts/photos/issues/402); say which case applies.)
- **Commit frequently.** Small, coherent commits at each meaningful slice of
  work; push regularly so CI and the draft PR stay current. No end-of-session
  mega-commits.
- **Use the status footer only during an active validation/build run or while
  pairing with the user on manual testing.** Omit it from routine turns. When it
  applies, report these three lines:
  - `Working dir:` absolute path of the active worktree/checkout
  - `Build:` result of the relevant gates (e.g. `npm run ci` pass/fail, or
    "not run" with the reason)
  - `Commit:` current branch + short SHA, with a dirty-state note if
    uncommitted changes remain

## Product Invariants

_None yet — the app has no product surface. As photos takes shape, the
highest-stakes rules (data model, storage, privacy) are recorded here and, where
possible, enforced as executable checks._

## Branch And GitHub Hygiene

- Development is trunk-based: short-lived branches cut from latest `main`,
  merged back via PR. No separate integration branch.
- **Merge only into `main`. Do not stack branches.** Every branch is cut from
  the current `main` tip and every PR bases on `main` — never open a PR whose
  base is another feature branch, and never build one branch on another's
  unmerged work. Multiple agents run here in parallel: a stacked branch breaks
  the moment the branch below it merges (its commits are rewritten onto `main`,
  leaving the upper branch dirty and its PR full of already-merged diffs). If
  your work genuinely depends on an unmerged change, wait for that PR to merge,
  then branch from the updated `main`.
- Check `git status` before changing anything; preserve unrelated user work.
- Open PRs with explicit closing references (`Closes #N`) when the PR completes
  an issue — the close-linked-issues workflow parses the merged PR body.
- Review/issue feedback gets a visible reply before the thread is resolved:
  what commit fixed it, why no action was needed, or what linked follow-up owns
  it. Never resolve threads silently.
- If a push seems to not trigger CI, or a PR shows a stale failing check: check
  `gh pr view <n> --json mergeable` FIRST — GitHub creates no workflow runs for
  a CONFLICTING PR. Rebase onto `main`, then push.

## Documentation And Validation

- Wiki-first: long-lived docs, SOPs, ADRs, and agent pitfalls belong in the
  [wiki](https://github.com/qwts/photos/wiki). Other repo markdown is pointer
  stubs, except agent instruction files, `CONTRIBUTING.md`, and root `README.md`
  (see the wiki [Repo Documentation Pointer Map](https://github.com/qwts/photos/wiki/Repo-Documentation-Pointer-Map)).
- Before claiming done: run `npm run ci` (lint chain → format:check → test:cov →
  build — the same non-browser gates CI enforces, including the `.c8rc.json`
  coverage floor and the happy-dom renderer lane in `tests/dom`). Use
  `npm run test:dom` for a focused renderer DOM check. For E2E-relevant changes
  also run `npm run test:e2e`; for
  renderer/story-relevant changes also run `npm run test:stories:ci` (Storybook
  interaction tests — CI runs them in the core job). Do not report a build you
  did not run.
- The macOS package job also loads the native HEIC decoder from the packaged
  app and decodes the checked-in iPhone fixture. Keep
  `scripts/verify-macos-heic-preview.mjs` and its readiness marker current when
  changing the native bridge, package layout, Electron ABI, or HEIC fixtures.
- Floors are ratchets — c8 (lines 90 / branches 80), type-coverage (99.8), the
  800-line file budget, the a11y violation budget (`tests/a11y/violation-budget.json`):
  raise them as coverage improves; never lower them to pass. The a11y budget
  ratchets the other way — its counts only **shrink**, and a surface that comes
  in under budget fails until the number is tightened. See the wiki
  [Testing Strategy](https://github.com/qwts/photos/wiki/Testing-Strategy)
  and [ADR-0001](https://github.com/qwts/photos/wiki/ADR-0001-Automation-Check-Governance).
- **A11y runs in three lanes, and none of them subsumes the others.** `jsx-a11y`
  (strict, `src/renderer`) reads the **source**, so pointer-only handlers and
  label/control mismatches fail at authoring time; the **story** lane runs axe
  over every story; the **E2E** lane runs axe over composed flows plus the
  focus-obscured probe for SC 2.4.11, which has no axe rule. A story-lane pass
  proves nothing about composition, and an axe pass proves nothing about
  criteria axe does not implement — roughly two thirds of WCAG. The wiki
  [Accessibility Audit](https://github.com/qwts/photos/wiki/Accessibility-Audit-2026-07)
  records which criteria are gated and which rest on the manual pass.
- **Never suppress an a11y rule bare.** `reportUnusedDisableDirectives` is
  `error`, so every `eslint-disable` must carry a reason: either why the code is
  verified correct, or the issue that owns the debt. When the fix lands the
  directive stops matching and the build fails until it is deleted — that is the
  ratchet, applied to exemptions. A blanket `rules: {'jsx-a11y/x': 'off'}` in a
  PR needs the same justification as lowering a coverage floor.
- **License-policy gate** (`lint:licenses`, part of the `lint` chain in
  `npm run ci`): `scripts/check-licenses.mjs` audits the _shipped_ dependency
  closure (production deps of `dependencies`/`optionalDependencies` plus the
  bundled `electron` runtime — see `scripts/dependency-closure.mjs`, not
  `devDependencies`) against the SPDX allowlist in `.license-policy.json`, and
  the same step verifies `THIRD-PARTY-NOTICES.md` is not stale. A new/upgraded
  dependency with a non-allowlisted or undeclared license fails CI until it is
  allowlisted or given a reviewed `exceptions` entry with a reason; then run
  `npm run licenses:notices` to refresh attributions. A CycloneDX SBOM
  (`npm run licenses:sbom`) is emitted into `release/` by the `package*` scripts.
- Dependencies use **exact pins**; Dependabot is the only actor that bumps
  versions. A set of **toolchain caps** holds back majors that would break the
  build: TypeScript stays **below 6.1.0** (typescript-eslint's peer cap),
  `@types/node` tracks the `.nvmrc` runtime major, Electron stays on the
  prebuilt-ABI major, and Vite / `@vitejs/plugin-react` / React are held until
  `electron-vite` supports Vite 8 and React 19 is migrated deliberately. Each is
  a Dependabot ignore; `.github/dependabot.yml` is the source of truth for the
  exact bounds and removal conditions.
- **`axe-core` is pinned exact and overridden into `axe-playwright`** (which
  depends on a floating `^4.10.1`). Its rule set _defines_ the a11y
  violation-budget counts, so an unpinned bump would move every number with no
  diff naming the cause. A Dependabot bump of it is _expected_ to move counts:
  re-audit and re-baseline in that PR
  (`OVERLOOK_A11Y_REPORT=<path> npm run test:stories:ci`), never widen the tags
  or raise a budget to make it pass.
- **`eslint-plugin-jsx-a11y` is overridden onto `$eslint`.** Its latest release
  (6.10.2) caps its peer at ESLint 9 and this repo is on 10, so npm refuses the
  install without the override. The rules were verified to actually run under
  ESLint 10 — this is a stale peer range, not an incompatibility. Revisit when
  upstream ships ESLint 10 support; if a bump ever breaks rule execution the
  symptom is jsx-a11y silently reporting **nothing**, so treat a sudden drop to
  zero findings as a failure, not a win.
- Behavior-changing PRs include a changeset (`npx changeset`); docs/tooling-only
  PRs may skip it. 0.x semantics (minor = behavior-changing, patch = fixes):
  wiki [ADR-0002 Versioning Policy](https://github.com/qwts/photos/wiki/ADR-0002-Versioning-Policy).
  `CHANGELOG.md` is generated by `npm run changeset:version` — never hand-edit.
- Releases are cut by merging the bot-maintained **Version packages** PR (the
  version-cut workflow keeps it current while changesets are pending). That
  merge is tagged `v0.x.y` automatically and the Release workflow publishes
  mac + win builds, CHANGELOG notes, and the design-package zip. Signing is
  env-gated on repo secrets (#128): with `CSC_LINK` present the mac build is
  signed + notarized and the tag becomes a full release; restricted Touch ID
  identity entitlements are included only when `MAC_PROVISIONING_PROFILE` is
  also present and validated. Without `CSC_LINK`, the tag is an unsigned
  pre-release. The macOS release gate extracts the generated ZIP and launches
  it in an isolated smoke mode. Never hand-tag releases or invoke Changesets
  versioning directly.

## Tooling

- Node is pinned in `.nvmrc`; select it (`nvm use`) before installing. CI reads
  the same file — bump it to move local and CI together.
- Install with `npm ci`; it also installs the husky pre-commit hook
  (lint-staged: `eslint --fix` + prettier on staged files). Fix what it flags;
  `git commit --no-verify` is for emergencies.
- The `/check` command (`.claude/commands/check.md`) wraps the full gate run.
- Invoke tools through `PATH` (or `npx`); never hardcode machine-specific paths.
