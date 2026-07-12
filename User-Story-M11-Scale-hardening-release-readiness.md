# M11: Scale, hardening & release readiness

**Epic:** [#46](https://github.com/qwts/photos/issues/46) · **Lane:** Closing

The closing epic: prove the 200K-photo target with a perf harness and budgets, audit crash-safety (interrupted import/backup, orphan repair), sweep the acceptance-coverage-map to completeness, replace gradient placeholder fixtures with real sample images, security-review the crypto/IPC surfaces, and stand up signed/notarized packaging (**blocked on user-supplied signing certs** — flagged on its issue).

## Issues

| # | Title | Blocked by |
| --- | --- | --- |
| [#123](https://github.com/qwts/photos/issues/123) | 200K-library performance harness + budgets | #72, #74 |
| [#124](https://github.com/qwts/photos/issues/124) | Grid/thumbnail performance tuning to budget | #123 |
| [#125](https://github.com/qwts/photos/issues/125) | Crash-safety audit: kill-tests for import/backup, orphan repair | #87, #105 |
| [#126](https://github.com/qwts/photos/issues/126) | Acceptance-coverage-map completeness sweep | #90, #96, #101, #110, #116, #122 |
| [#127](https://github.com/qwts/photos/issues/127) | Real sample-image fixtures replace gradient placeholders | #72 |
| [#128](https://github.com/qwts/photos/issues/128) | Signed & notarized packaging (needs certificates) | #53 |
| [#129](https://github.com/qwts/photos/issues/129) | Security review: crypto and IPC surfaces | #107 |

## Definition of done

See the epic issue [#46](https://github.com/qwts/photos/issues/46) — the epic body is canonical; this page is the planning index entry.
