# ADR-0028: Remote Custody Binding and Custody-Safe Provider Disconnect/Switch

## Status

Accepted 2026-07-22 — governing ADR for
[#723](https://github.com/qwts/photos/issues/723) (custody-safe provider
disconnect and switching for cloud-only originals), proposed under the #723
kickoff (process precedent: ADR-0022 ↔ #483, ADR-0023 ↔ #534,
ADR-0026 ↔ #547; the owner may veto or amend any section before its
implementing code lands). Implementation issues are filed against named
sections after this ADR; no slice may weaken this contract without an ADR
amendment — semantics change here first, code second.

This ADR extends
[ADR-0007](./ADR-0007-Backup-Format-And-Offload.md) (offload semantics and
failure truth), [ADR-0011](./ADR-0011-Provider-Catalog-Capabilities-And-Switching.md)
(disconnect/switch policy), [ADR-0012](./ADR-0012-Continuous-Backup-Integrity-And-Recovery-Repair.md)
(integrity scrub routing and cursors), and
[ADR-0017](./ADR-0017-Multi-Library-Registry-Keying-And-Lifecycle.md)
(credential scoping); it rewrites none of them. Each carries an amendment
pointer to this ADR.

## Context

An offloaded original has exactly one durable copy: the encrypted envelope in
the provider account it was uploaded to. Nothing in the durable model records
which account that was:

- A `sync_ledger` row carries only `photo_id`, `status`, `last_backup_at`,
  `dirty` (`src/main/db/migrations.ts:75-129`). `offloaded` names a state, not
  a place.
- Every engine — offloaded reads and restore (`src/main/backup/offload.ts`),
  ephemeral viewing and Keep downloaded
  (`src/main/backup/ephemeral-originals.ts`), integrity scrub/repair
  (`src/main/backup/integrity-scrubber.ts`), purge remote deletion
  (`src/main/library/purge-service.ts`), cloud restore
  (`src/main/backup/restore-engine.ts`) — holds one shared facade
  (`src/main/backup/active-provider.ts`) that re-resolves
  `settings.providerId` on every call. Whatever is selected _now_ receives
  custody operations for originals uploaded _then_.
- Credentials are one slot per provider ID per profile
  (`userData/provider-auth/<providerId>`, ADR-0017 §6). Signing the same
  provider into a different account replaces the slot; only the iCloud adapter
  pins an account token and can even notice
  (`src/main/backup/icloud-drive/authority-store.ts`). pCloud and Google Drive
  persist no account subject.
- The fail-closed guards ask only "is some provider selected"
  (`src/main/backup/offload.ts:182-191`), never "is the authority that holds
  this blob reachable". ADR-0011 blocks disconnect/switch only while backup or
  restore work is _active_; a quiet library disconnects instantly, and the
  confirmation copy (`src/renderer/src/settings/StoragePane.tsx:54-61`)
  promises remote data is not deleted without saying cloud-only originals
  become unreadable on this device.

So a user can offload verified originals, disconnect, connect a different
provider — or the same provider under a different account — and every read,
scrub, repair, purge, and restore for those rows is silently routed to a
remote that never held them. Recoverable originals present as missing or
corrupt; a scrub can mark them `error`; a purge believes it deleted them. The
missing invariant: **before removing or changing authority, prove that no
original depends solely on it — or durably preserve and enforce the exact
authority needed to recover it.**

## Decision

### 1. Custody authority record — a library-scoped, non-secret binding

The encrypted library database gains a `custody_authorities` table, written
only by the main process inside the existing forward-only migration chain
(ADR-0005):

- `id` — integer primary key;
- `provider_id` — stable lowercase provider ID (ADR-0011 catalog);
- `account_id` — the adapter's stable, non-secret account subject (§2);
- `account_label` — display label (e-mail or account name) for UI copy only,
  never used for matching;
- `remote_root` — the bound namespace, canonically `/Overlook/<library-id>/`
  (ADR-0007); recorded, not derived, so a future layout change cannot
  silently rebind old rows;
- `state` — `bound | provider-required` (§4–§5);
- `created_at`, `last_verified_at` — ISO timestamps; `last_verified_at` is
  stamped only by successful verification (§6), never by connect alone.

`sync_ledger` gains `custody_authority_id INTEGER NULL REFERENCES
custody_authorities(id)`. The column is the row's **source-custody
provenance**:

- It is **set in the same transaction** as any transition into `offloaded`,
  to the verified authority the upload/eligibility check ran against.
- It is **cleared in the same transaction** as any transition that makes
  durable, verified local bytes authoritative again (`offloaded → synced` via
  Keep downloaded / restore-originals). Ephemeral viewing custody (ADR-0007)
  never touches it — the durable row stays `offloaded` and bound.
- A row transitioned to `error` from `offloaded` **keeps its binding**: the
  claim "the authority that should hold this is X" survives the failure, per
  ADR-0012's rule that remote loss is made explicit, not relabeled.
- Rows in `local | syncing | synced` states carry `NULL` — local bytes are
  authoritative and the current backup target (the ADR-0011 selection)
  governs new work. The binding exists exactly for sole-remote-custody rows.

The binding is **library-scoped** (it travels with the library directory and
appears in its database), while credentials remain **profile-scoped**
(ADR-0017 §6 unchanged): an account authenticates a profile; custody binds a
library's rows. Secrets never enter the table — `account_id` must be a
non-secret subject identifier, never a token.

### 2. Account authority identity — every adapter must name its account

Connecting is no longer complete until the adapter reports a stable
`{ accountId, accountLabel }`:

- **pCloud** — `userinfo.userid` (numeric, region-stable) as `accountId`,
  account e-mail as label.
- **Google Drive** — `about.user.permissionId` as `accountId` (stable,
  unlike e-mail), `emailAddress` as label.
- **iCloud Drive** — the existing pinned ubiquity account token
  (`ICloudDriveAuthorityStore`) is the `accountId`; the label is the
  OS-reported account name where available. This generalizes the pinning that
  adapter already does alone.
- **Mock** — a fixed `mock-account` (overridable in tests to exercise
  wrong-account paths).

An adapter that cannot establish its account identity **fails the connect**
(typed, retryable error) rather than connecting anonymously — an anonymous
connection could never satisfy or safely create a binding. The capability
descriptor (ADR-0011) is extended so shared contract tests exercise identity
capture, identity change, and identity-unavailable for every adapter.

### 3. Custody operations are binding-addressed, never selection-addressed

The single active-provider facade splits into two roles:

- **Backup target** (unchanged mechanics): new uploads, manifest/bootstrap
  publication, quota, and connect/disconnect UI follow the ADR-0011 selection
  (`settings.providerId`) as today.
- **Custody handle**: any operation whose subject is a sole-remote-custody
  row — offloaded reads (view, export, neighbor prefetch), restore-originals,
  Keep downloaded, integrity verify/repair of `offloaded` rows, purge remote
  deletion, and remote deletion of any bound object — resolves its provider
  through the row's `custody_authority_id`. Resolution succeeds only when the
  live connection matches the record on **all three** of provider ID, account
  ID, and remote root. Any mismatch fails closed with a typed reason that
  distinguishes `custody-disconnected` (no live connection for the bound
  provider), `custody-wrong-account` (same provider, different `account_id`),
  and `custody-unavailable` (bound provider connected but transiently
  unreachable/expired) — three distinct states, never collapsed into
  "disconnected" and never reported as missing or corrupt data.

`settings.providerId` therefore **never authorizes custody operations**. A
different connected provider is a valid backup target for _new_ work while
old rows remain bound elsewhere; it receives none of their reads, scrubs,
repairs, purges, or deletes (acceptance scenario 8). ADR-0012's scrub walks
`synced` rows against the backup target and `offloaded` rows against their
bound authority, and its provider-scoped cursors become authority-scoped.

### 4. Ordinary disconnect/switch is custody-gated, with restore-first

Disconnect and switch gain a **preflight** over the active library: the exact
count and total bytes of rows whose sole durable copy is bound to the
authority being removed (`offloaded` rows plus `error` rows that retain a
binding).

- **Zero sole-custody rows**: disconnect proceeds as today — credentials
  cleared, `providerId → null`, remote objects untouched. Authority records
  with no referencing rows are deleted.
- **One or more**: the ordinary path is **blocked**. The dialog reports the
  exact item and byte counts and offers **Restore all originals first**,
  which runs the existing verified restore-originals workflow
  (download → authenticate envelope → verify content address → durable commit
  → ledger `offloaded → synced` with the binding cleared per §1). Disconnect
  unlocks only when the preflight recount reaches zero. Interruption,
  offline, auth expiry, insufficient space, corrupt/missing remote objects,
  or verification failure leave the provider connected and every unresolved
  row bound and `offloaded` (or `error` with binding, for remote loss) —
  ADR-0007's failure-truth states, unchanged.
- The ADR-0011 active-work rejection still applies first; this gate is
  additive.
- Disconnect **never deletes remote objects** — unchanged, and now stated as
  a custody invariant rather than reassurance copy.

The minimum safe release requires complete verified local restoration before
an ordinary switch. Simultaneous dual custody exists only inside the §8
migration contract, never as an ordinary state.

### 5. Emergency authorization removal — user agency without relabeling

A separate **Remove authorization anyway** path (revoked device, compromised
account, abandoned provider) stays available behind explicit destructive-risk
ceremony (ADR-0023 vocabulary):

- Credentials are cleared and the selection nulled exactly like ordinary
  disconnect.
- Every affected authority record flips to `state = 'provider-required'` and
  **retains** `provider_id`, `account_id`, `account_label`, `remote_root`.
  Bound ledger rows are untouched: still `offloaded`, still bound — never
  relabeled `local`, missing, or corrupt.
- The library enters a surfaced **provider required** condition, derived from
  the existence of `provider-required` authorities with dependent rows — not
  a second persisted flag. It survives restart and library switching (it
  lives in the library database), and it renders in Settings, the sync
  status surfaces, Inspector, and lightbox/export failures with the exact
  recovery requirement: reconnect provider X as account label Y.
- Metadata and thumbnails remain browsable (ADR-0007 thumbs-stay eviction);
  only original-dependent actions fail, each naming the requirement.

### 6. Reconnect verification — same provider, same account, proven namespace

Connecting while `provider-required` (or `bound`-but-disconnected)
authorities exist runs **rebinding verification** before any custody
operation resumes:

- **Identity match**: the live adapter's `accountId` must equal the recorded
  `account_id` for that `provider_id`. A different account connects as a
  backup target only (§3); it never satisfies, overwrites, or deletes the
  old binding, and the affected rows are not relabeled (acceptance
  scenario 7).
- **Namespace proof**: Overlook opens `remote_root` and authenticates
  `recovery/bootstrap.ovrb` with the library master (ADR-0009); the payload's
  library ULID must match this library. This proves the namespace is this
  library's home under that account — account metadata alone is not trusted.
- On success: `state → bound`, `last_verified_at` stamped, custody operations
  resume. **No ledger transitions are fabricated** — rows were `offloaded`
  throughout and remain so; per-object existence is re-proven by ADR-0012's
  scrub and by each verified read, exactly as before the disconnect.
- On failure (bootstrap missing/invalid, wrong ULID, wrong key): the
  connection stands as a backup-target credential, the binding stays
  unsatisfied, and the state is reported as wrong-account/unavailable — not
  as data loss.

### 7. Legacy rows — verify, never assume

Existing libraries have `offloaded` rows with no provenance. The schema
migration **must not** guess:

- The migration adds the table and column with `custody_authority_id = NULL`
  for every existing row. A `NULL`-bound `offloaded` row is **legacy-unbound**:
  custody operations on it are gated exactly like `provider-required` (§5)
  until it is bound.
- **Binding is earned by verification**: when a connected provider passes §6
  namespace proof for this library, a bounded reconciliation pass (riding the
  ADR-0012 scrub cadence) verifies each legacy row's object under
  `remote_root` (provider checksum/size against the recorded ciphertext hash,
  ADR-0007 verify semantics) and binds rows as they prove out. Rows whose
  objects are absent surface through the existing integrity-error contract,
  still unbound.
- Newly supplied credentials are **never** blanket-assigned to legacy rows
  (acceptance scenario 11). In the common case — the user never changed
  provider or account — reconciliation completes invisibly on the first
  post-upgrade scrub cycles.

### 8. Provider migration — specified, deferred

A supported migration from authority A to authority B is
**copy → verify → atomic rebind**: every required object plus recovery
metadata (bootstrap, manifest generation) is copied to B and verified with
ADR-0007 semantics before a single transaction rebinds the affected rows;
cancellation or failure at any point leaves A authoritative and B's partial
copy inert (ADR-0007's discovery invariant already hides bootstrap-less
homes). No implementation is scheduled by this ADR; until one lands, the only
supported path off an authority holding sole custody is §4 restore-first.
Shipping migration requires only implementation issues, not an amendment,
provided this shape is preserved.

### 9. Honest surfaces

Renderer slices own the exact copy, but these honesty requirements are
contract:

- The ordinary disconnect confirmation must state the §4 preflight result;
  "encrypted data is not deleted" reassurance may not appear without the
  cloud-only consequence when the count is non-zero.
- Disconnected, wrong-account, unavailable (transient), missing/corrupt
  (per-object, ADR-0012), provider-required, legacy-unbound, and migrated
  states render distinctly wherever sync state is shown (status surfaces,
  Inspector, lightbox, export failures), with accessible announcements — no
  state may borrow another's copy (ADR-0004's factual-copy rule applies).
- Byte/item counts in preflight and provider-required surfaces render with
  the `.mono-data` machine-data convention.

## Consequences

- **Easier**: "offloaded" becomes a claim about a named, verifiable place;
  wrong-account incidents become a typed, recoverable state instead of
  phantom data loss; iCloud's account pinning generalizes instead of staying
  a special case; ADR-0012's scrub gains the routing its cursors already
  implied.
- **Harder**: one more custody table and a ledger column ride the
  forward-only migration chain; every adapter must surface account identity
  or lose connectability; the offload transaction grows a binding write; the
  scrub carries the legacy reconciliation pass until old libraries age out.
- **Implementation slices** (filed after acceptance; each independently
  reviewable): (a) schema + ledger transaction changes (§1, §7 migration);
  (b) adapter account identity + descriptor/contract tests (§2);
  (c) custody-handle routing and typed fail-closed reasons (§3);
  (d) disconnect preflight, restore-first gate, emergency path (§4–§5);
  (e) reconnect verification + legacy reconciliation (§6–§7);
  (f) renderer surfaces and a11y (§9). Deterministic unit/integration
  coverage plus Electron E2E and provider/account-change acceptance ride
  their owning slices; #723's twelve acceptance scenarios map onto (a)–(f).
- **Deferred, with owners**: provider migration execution (§8) — new issue
  when wanted; multi-account credential slots per provider (ADR-0017 §6
  deferral) — unchanged, and §3 makes single-slot safe in the meantime;
  binding `synced` rows as well (backup provenance, not custody) — revisit if
  multi-provider backup ever lands.
- **Revisit when**: a provider changes its stable subject semantics (e.g.,
  Google `permissionId` deprecation) — adapter amendment; remote layout ever
  moves off `/Overlook/<library-id>/` — `remote_root` already records, but
  §6's proof path must follow.
