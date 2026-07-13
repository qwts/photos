---
'photos': patch
---

Security review (#129): adversarial audit of the crypto envelope/keystore, the IPC registry + custom protocol handlers, and a plaintext-at-rest sweep. All three seams verified sound against the ADR-0004 threat model — no fix-before-release findings. Hardening fix (F1): the test/dev harness env hooks (`OVERLOOK_SEED`, `OVERLOOK_SEED_SYNTHETIC`, `OVERLOOK_IMPORT_SOURCE`, `OVERLOOK_EXPORT_DESTINATION`, `OVERLOOK_BACKUP_FAULT`, `OVERLOOK_USER_DATA`) are now honored only in unpackaged builds via a single `harnessEnv()` gate, matching the existing `OVERLOOK_INSECURE_KEYSTORE` posture — a packaged app can no longer be steered via env. The written review and ADR-0004 accepted-deviation notes live in the wiki; follow-up hardening is tracked in #229 (per-key nonce budget), #230 (central IPC error scrubber), and #231 (protocol least-privilege polish).
