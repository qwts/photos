# photos Wiki

This wiki holds photos' canonical process, planning, and SOP documentation.
Repository markdown docs are pointer stubs unless they are compact agent
instructions or entrypoints (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, root
`README.md`).

## Start Here

- [Contributing](Contributing) — contributor + agent workflow guide (canonical)
- [Repo Documentation Pointer Map](Repo-Documentation-Pointer-Map) — which doc lives where

## Canonical Documentation Groups

- [Testing Strategy](Testing-Strategy) — test lanes, coverage floors, when each lane must grow
- [Architecture Decision Records](Architecture-Decision-Records) — ADR index + template
- [User Stories](User-Stories) — milestone / user-story planning home

## Maintenance Convention

- Detailed process/SOP/planning docs live **here**; repo files stay compact pointers.
- Wiki updates happen **as part of** issue/PR work — a change that alters
  workflow, testing strategy, or architecture updates the wiki page in the same
  unit of work, not after the fact.
- ADRs are appended, never rewritten; superseding decisions get a new ADR that
  links back.
