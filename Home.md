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
- [Deterministic Reviewed Sync acceptance](Acceptance-Test-Deterministic-Reviewed-Sync) — replay, conflict, tombstone, and restart evidence
- [Security Review M11](Security-Review-M11) — crypto/IPC/plaintext audit (#129) + accepted deviations
- [M20 Privacy Lock, Touch ID & Protected Albums](User-Story-M20-Privacy-lock-protected-albums) — app-lock, biometric, recovery, and protected-domain contract
- [Protected Albums acceptance](Acceptance-Test-Protected-Albums) — #325–#329 custody, migration, leakage, lifecycle, and UI evidence
- [User Stories](User-Stories) — milestone / user-story planning home
- [Cloud Provider Contract Matrix](Provider-Contract-Matrix) — adapter backup/restore readiness and live evidence
- [Manual Test — M18 Cloud Disaster Recovery](Manual-Test-M18-Cloud-Disaster-Recovery) — isolated owner-run pCloud procedure
- [Accessibility Audit — WCAG 2.2 AA (July 2026)](Accessibility-Audit-2026-07) — baseline, severity ranking, accepted exceptions (#398)
- [Manual Test — VoiceOver](Manual-Test-A11y-VoiceOver) — the screen-reader half the axe gates cannot cover
- [Spike — Multi-Platform Port](Spike-Multi-Platform-Port) — iOS/iPadOS/tvOS/visionOS/Android/Windows feasibility; findings only, no decision

## Maintenance Convention

- Detailed process/SOP/planning docs live **here**; repo files stay compact pointers.
- Wiki updates happen **as part of** issue/PR work — a change that alters
  workflow, testing strategy, or architecture updates the wiki page in the same
  unit of work, not after the fact.
- ADRs are appended, never rewritten; superseding decisions get a new ADR that
  links back.
