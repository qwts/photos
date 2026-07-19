# ADR-0008: Recovery-Key File Format and KDF

## Status

Accepted (2026-07-13, at M18 start per the standing goal-run authorization;
the owner may veto or amend on issue
[#240](https://github.com/qwts/photos/issues/240) — the recovery
implementation builds against these sections)

## Context

M18 (#240) ships local recovery-key management per the updated design
handoff: Settings → Privacy exports the library key to a password-encrypted
`overlook-recovery.key`, and importing that file on another device unlocks a
restored library. Custody today ([ADR-0004](./ADR-0004-Encryption-And-Key-Management.md)):
a 32-byte master key wrapped by the OS keychain (`master.key` via
`safeStorage`), which GCM-wraps the versioned library keys in `keys.json`.
Losing the keychain (new device, OS reinstall) loses the library — the
recovery file is the escape hatch, and it must not weaken the at-rest story.

## Decision

**What is exported: the master key.** The 32-byte master unwraps every
`keys.json` row, so one small file recovers every key generation past and
future — re-exporting after rotation is unnecessary (rotation mints library
keys, not masters).

**File format (`overlook-recovery.key`, 77 bytes, version 1):**

```
magic "OVRK" (4) ‖ version 0x01 (1) ‖ salt (16) ‖ nonce (12)   — header, also GCM AAD
‖ ciphertext(master key, 32) ‖ GCM tag (16)
```

Fixed length; anything else is rejected as `invalid` before any KDF work.
The header rides as AAD, so a version/salt/nonce flip fails the same tag
check as a wrong password — tampering and wrong passwords are deliberately
indistinguishable (`wrong-password`), and no oracle distinguishes them.

**KDF: scrypt, N=2^17, r=8, p=1, 32-byte output.** Node's built-in scrypt —
no new native dependency under the exact-pin policy (argon2id would cost a
prebuilt native module; scrypt at 128 MiB is memory-hard enough for this
rare, user-present operation, ~1s per derivation). Parameters are fixed per
format version: a future strengthening bumps the version byte rather than
parsing attacker-controlled cost parameters from the file (no
client-chosen-cost downgrade).

**Password policy is UX-gated, not format-gated:** the dialog requires
confirmation, a strength score ≥ 3 (the mock's own heuristic, shared module
`src/shared/crypto/password-strength.ts`), and an explicit "cannot be reset"
acknowledgment. Nothing about the password is stored anywhere, by
construction — there is no reset path.

**Fingerprint:** the UI identifier ("9F2C·4A81·D0E7·5B3A") is 8 bytes of
`HKDF-SHA256(master, info="overlook recovery fingerprint v1")` — a derived
identifier, never a truncated hash of raw key material, and stable across
devices so a user can visually match custody after an import.

**Install semantics (`installRecoveredMaster`):** import works precisely
when the keystore cannot open (the restore scenario). Rules, in order: an
empty directory (no `keys.json` rows AND no `master.key`) is refused
(`no-library` — installing into a void would wedge the next bootstrap's
"master exists but no library keys" guard; restore the library files first);
if `keys.json` exists with rows, the imported master must unwrap every row
(else `mismatch` — the honest "this key is not this library's"); a matching
installed master is a no-op (`already-installed`); a *different* master with
no keys file to arbitrate is refused (`mismatch` — never overwrite working
custody blindly); otherwise the key is installed by atomic temp+rename,
keychain-wrapped exactly like a minted master. A validated key MAY replace a
differing `master.key` when the keys file vouches for it — that is exactly
the freshly-minted-wrong-master state a failed bootstrap leaves on a
restored directory.

**IPC:** `keys:status` / `keys:export` / `keys:pick-file` / `keys:import`
(zod-validated, #49 registry). The password crosses the context-isolated
bridge as an argument and is never logged or persisted; JS strings cannot be
zeroized — accepted (matches the platform reality of every Electron password
prompt).

## Consequences

- Anyone holding the file **and** the password holds the library: the export
  dialog says so in the design's own copy, and gates on the acknowledgment.
- Offline guessing costs ~1s and 128 MiB per attempt at N=2^17; the real
  defense is the strength gate plus user education (file and password stored
  apart, offline).
- A restored library needs `keys.json` + blobs + DB alongside the imported
  master (the pCloud restore flow is future work; disk copies work today, as
  the E2E proves).
- Version byte 1 reserves the upgrade path (harder KDF, argon2id if a
  prebuilt lands, multi-key escrow) without parsing untrusted parameters.

## Security review

Adversarial pass at implementation time (recorded on
[#240](https://github.com/qwts/photos/issues/240)): no blockers; four
hardenings landed with the PR — exact-size `stat` gate before buffering the
import path (renderer-supplied), the `no-library` refusal above, a 1024-char
password ceiling in the IPC schema, and a main-side 8-char password floor on
export. Accepted risks, deliberate: `scryptSync` blocks the main process ~1s
per rare user-present operation; JS strings can't be zeroized; AES-GCM is
non-key-committing (exploiting it requires the victim's master + local FS
write — already game-over).

## Verification

`tests/crypto/recovery.test.ts` (round trip, wrong password, tamper,
invalid, salt/nonce freshness, fingerprint stability, all install rules) and
`tests/e2e/keys-recovery.spec.ts` (export on device A → restore files to B →
wrong password fails on the designed copy → import → relaunch decrypts A's
photos with A's fingerprint).
