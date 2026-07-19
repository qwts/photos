# Repo Documentation Pointer Map

This page maps repository markdown documentation to its canonical home, so
nothing is duplicated. Repo paths are retained as pointer stubs so existing
issue, PR, and comment links continue to work.

| Repository path                        | Canonical home                                          |
| -------------------------------------- | -------------------------------------------------------- |
| `README.md`                             | Canonical in the repository (quickstart + script table)  |
| `CONTRIBUTING.md`                       | Pointer stub → [Contributing](./Contributing.md)               |
| `AGENTS.md`                             | Shared agent-context file (repo-canonical); long-form workflow → [Contributing](./Contributing.md) |
| `CLAUDE.md`                             | Claude Code orientation pointing into `AGENTS.md` (repo-canonical)  |
| `.github/copilot-instructions.md`       | Copilot review orientation pointing into `AGENTS.md` (repo-canonical) |
| `.claude/commands/check.md`             | `/check` command wrapping the local gate run (repo-canonical)        |
| ADRs                                    | Wiki-only: [Architecture Decision Records](./adr/Architecture-Decision-Records.md) (no repo copies) |
| User-story / milestone planning         | Wiki-only: [User Stories](./stories/User-Stories.md)                    |
| Testing strategy                        | Wiki-only: [Testing Strategy](./Testing-Strategy.md)            |

## Rules

- New process/SOP/planning docs go **in the wiki** and get a row here only if a
  repo stub exists or is needed for discoverability.
- Update the wiki page behind a stub, never the stub itself.
- When adding a repo pointer stub, keep it compact: title, one-line description,
  link, and "update the wiki page, not this stub."
