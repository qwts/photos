# Repo Documentation Pointer Map

This page maps repository markdown documentation to its canonical home, so
nothing is duplicated. Repo paths are retained as pointer stubs so existing
issue, PR, and comment links continue to work.

| Repository path                        | Canonical home                                          |
| -------------------------------------- | -------------------------------------------------------- |
| `README.md`                             | Canonical in the repository (quickstart + script table)  |
| `CONTRIBUTING.md`                       | Pointer stub → [Contributing](Contributing)               |
| `AGENTS.md`                             | Compact agent instructions (repo-canonical); long-form workflow → [Contributing](Contributing) — lands with issue [#15](https://github.com/qwts/photos/issues/15) |
| `CLAUDE.md`                             | Compact agent instructions (repo-canonical); long-form workflow → [Contributing](Contributing) — lands with issue [#15](https://github.com/qwts/photos/issues/15) |
| ADRs                                    | Wiki-only: [Architecture Decision Records](Architecture-Decision-Records) (no repo copies) |
| User-story / milestone planning         | Wiki-only: [User Stories](User-Stories)                    |
| Testing strategy                        | Wiki-only: [Testing Strategy](Testing-Strategy)            |

## Rules

- New process/SOP/planning docs go **in the wiki** and get a row here only if a
  repo stub exists or is needed for discoverability.
- Update the wiki page behind a stub, never the stub itself.
- When adding a repo pointer stub, keep it compact: title, one-line description,
  link, and "update the wiki page, not this stub."
