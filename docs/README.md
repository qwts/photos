# photos Wiki

This wiki holds photos' canonical process, planning, and SOP documentation.
Repository markdown docs are pointer stubs unless they are compact agent
instructions or entrypoints (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, root
`README.md`).

## Start Here

- [Contributing](./Contributing.md) — contributor + agent workflow guide (canonical)
- [Repo Documentation Pointer Map](./Repo-Documentation-Pointer-Map.md) — which doc lives where

## Canonical Documentation Groups

- [Testing Strategy](./Testing-Strategy.md) — test lanes, coverage floors, when each lane must grow
- [Architecture Decision Records](./adr/Architecture-Decision-Records.md) — ADR index + template
- [Deterministic Reviewed Sync acceptance](./acceptance/Acceptance-Test-Deterministic-Reviewed-Sync.md) — replay, conflict, tombstone, and restart evidence
- [Security Review M11](./Security-Review-M11.md) — crypto/IPC/plaintext audit (#129) + accepted deviations
- [M20 Privacy Lock, Touch ID & Protected Albums](./stories/User-Story-M20-Privacy-lock-protected-albums.md) — app-lock, biometric, recovery, and protected-domain contract
- [Protected Albums acceptance](./acceptance/Acceptance-Test-Protected-Albums.md) — #325–#329 custody, migration, leakage, lifecycle, and UI evidence
- [User Stories](./stories/User-Stories.md) — milestone / user-story planning home
- [Cloud Provider Contract Matrix](./Provider-Contract-Matrix.md) — adapter backup/restore readiness and live evidence
- [Manual Test — M18 Cloud Disaster Recovery](./acceptance/Manual-Test-M18-Cloud-Disaster-Recovery.md) — isolated owner-run pCloud procedure
- [Accessibility Audit — WCAG 2.2 AA (July 2026)](./Accessibility-Audit-2026-07.md) — baseline, severity ranking, accepted exceptions (#398)
- [Manual Test — VoiceOver](./acceptance/Manual-Test-A11y-VoiceOver.md) — the screen-reader half the axe gates cannot cover
- [Overlook Library Format v1](./Library-Format-v1.md) — the on-disk format: layout, key hierarchy, envelope, recovery file, SQLCipher parameters
- [Spike — Multi-Platform Port](./Spike-Multi-Platform-Port.md) — iOS/iPadOS/tvOS/visionOS/Android/Windows feasibility; findings only, no decision

## Maintenance Convention

- Detailed process/SOP/planning docs live **here**; repo files stay compact pointers.
- Wiki updates happen **as part of** issue/PR work — a change that alters
  workflow, testing strategy, or architecture updates the wiki page in the same
  unit of work, not after the fact.
- ADRs are appended, never rewritten; superseding decisions get a new ADR that
  links back.
