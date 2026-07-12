---
name: User Story
about: Capture a photos user story with scope, acceptance scenarios, implementation notes, and test coverage.
title: '[Story]: '
labels: ['user story']
assignees: ''
---

# User Story

**Milestone:** <!-- Example: M01: Library model and import core -->
**Order:** <!-- Example: 3 -->
**Type:** <!-- Example: Feature / refactor -->

---

## User Story

As a <!-- user/persona -->, I want <!-- capability or behavior --> so I can <!-- outcome or value -->.

## Source Context

<!-- Summarize the source context, prior behavior, design notes, or planning documents this story is based on. -->

---

## Scope

- <!-- In-scope behavior, artifact, or implementation boundary. -->
- <!-- Keep each bullet concrete and testable. -->

## Out Of Scope

- <!-- Explicitly defer adjacent behavior that should not be implemented in this story. -->
- <!-- Call out related milestones or follow-up work where useful. -->

## Exit Criteria

- <!-- Observable pass condition. -->
- <!-- Build/runtime/manual validation condition. -->
- <!-- State, storage, permission, or security condition if applicable. -->

## Primary Modules

- `<!-- path/to/module.ts -->`
- `<!-- path/to/related-file.ts -->`

---

## Documentation Review Complete

- **Reviewed source context:** <!-- Docs, milestone files, behavior maps, architecture notes, or issue links reviewed. -->
- **Most important build guardrails:** <!-- Constraints that must hold during implementation. -->
- **Acceptance criteria added from review:** <!-- Criteria added after reviewing source context. -->
- **Still intentionally out of scope:** <!-- Deferred behavior that should not leak into this story. -->

## Acceptance Scenarios

- <!-- Concrete pass/fail scenario. Example: Given X, when Y, then Z. -->
- <!-- Include happy path, failure path, state transition, and boundary conditions where relevant. -->

## Planning Discipline To Apply Before Build

- **Shift-left validation:** Confirm contracts, threat model notes, edge cases, and regression checks before implementation begins. Add fixtures or manual checks before wiring broad UI behavior.
- **DRY and explicit interfaces:** Centralize repeated schemas, actions, repository calls, and status codes rather than copying logic into views.
- **Single responsibility:** Keep data model, storage, import/processing pipelines, and UI rendering in their own bounded modules.
- **UI-ready modularity:** Views should render from serializable state and dispatch named actions; no view should own persistence, processing, or library business rules.
- **Change isolation:** Volatile platform APIs, storage formats, and external services should sit behind adapters.
- **Secure/testable defaults:** Default to least privilege, bounded storage/request behavior, typed validation, and pure core functions that can be tested without DOM or network.

## Implementation Notes

- <!-- Patterns to preserve, commands/actions to introduce, or adapters to use. -->
- <!-- Module boundaries that implementation should not cross. -->
- <!-- Migration, schema, permission, or compatibility notes. -->

## Test Notes

- <!-- Manual happy-path check. -->
- <!-- Manual or automated failure-path check. -->
- <!-- Fixture, regression, or security check. -->

## Acceptance Criteria Coverage Review

### Missing Before This Planning Pass

- <!-- What was underspecified, ambiguous, or missing before review. -->

### Added In This Planning Pass

- <!-- What acceptance criteria, guardrails, or tests were added. -->

### Coverage Status

- <!-- Example: Complete / Partially covered / Blocked pending open questions. -->
- <!-- State any remaining uncertainty explicitly. -->

## Open Questions

- <!-- Decision that should be resolved explicitly before or during implementation. -->
- <!-- Keep unresolved assumptions visible instead of burying them in implementation. -->
