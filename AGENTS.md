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

- **New issue work:** investigate and root-cause (or confirm scope) before
  editing. State your understanding — problem, cause or confirmed scope, and
  intended changes — and ask if it is correct. Do not edit files until the user
  confirms or explicitly tells you to proceed.
- **After confirmation:** update the issue with the agreed problem, root cause
  or scope, and plan (issue comment per the wiki claim flow).
- **During implementation:** post issue comments for each meaningful change
  slice: what changed and why.
- **Before editing:** state in one short line each: likely fix, why it may not
  work, confidence (low/medium/high), possible regressions. Then implement.

## Working Agreement

- **Start with a draft PR.** After claiming an issue and branching, push the
  branch and open a **draft pull request** immediately — the first commit can
  be scaffolding or a failing test. Mark it ready-for-review only when
  `npm run ci` passes locally.
- **Commit frequently.** Small, coherent commits at each meaningful slice of
  work; push regularly so CI and the draft PR stay current. No end-of-session
  mega-commits.
- **End every turn with a status footer** of three lines:
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
  coverage floor). For E2E-relevant changes also run `npm run test:e2e`; for
  renderer/story-relevant changes also run `npm run test:stories:ci` (Storybook
  interaction tests — CI runs them in the core job). Do not report a build you
  did not run.
- Floors are ratchets — c8 (lines 90 / branches 80), type-coverage (99.8), the
  800-line file budget: raise them as coverage improves; never lower them to
  pass. See the wiki [Testing Strategy](https://github.com/qwts/photos/wiki/Testing-Strategy)
  and [ADR-0001](https://github.com/qwts/photos/wiki/ADR-0001-Automation-Check-Governance).
- Dependencies use **exact pins**; Dependabot is the only actor that bumps
  versions. A set of **toolchain caps** holds back majors that would break the
  build: TypeScript stays **below 6.1.0** (typescript-eslint's peer cap),
  `@types/node` tracks the `.nvmrc` runtime major, Electron stays on the
  prebuilt-ABI major, and Vite / `@vitejs/plugin-react` / React are held until
  `electron-vite` supports Vite 8 and React 19 is migrated deliberately. Each is
  a Dependabot ignore; `.github/dependabot.yml` is the source of truth for the
  exact bounds and removal conditions.
- Behavior-changing PRs include a changeset (`npx changeset`); docs/tooling-only
  PRs may skip it. 0.x semantics (minor = behavior-changing, patch = fixes):
  wiki [ADR-0002 Versioning Policy](https://github.com/qwts/photos/wiki/ADR-0002-Versioning-Policy).
  `CHANGELOG.md` is generated by `npm run changeset:version` — never hand-edit.

## Tooling

- Node is pinned in `.nvmrc`; select it (`nvm use`) before installing. CI reads
  the same file — bump it to move local and CI together.
- Install with `npm ci`; it also installs the husky pre-commit hook
  (lint-staged: `eslint --fix` + prettier on staged files). Fix what it flags;
  `git commit --no-verify` is for emergencies.
- The `/check` command (`.claude/commands/check.md`) wraps the full gate run.
- Invoke tools through `PATH` (or `npx`); never hardcode machine-specific paths.
