# ADR-0027: Native macOS Photo Interoperability and Plaintext Custody Boundary

## Status

Proposed — governing ADR for the [#564](https://github.com/qwts/photos/issues/564)
epic (native macOS photo interoperability). Per the repo ADR gate, no child
implementation that changes plaintext custody may begin until this reads
`Status: Accepted` (precedent ADR-0022 ↔ #483, ADR-0023 ↔ #534).

This ADR extends [ADR-0004](./ADR-0004-Encryption-And-Key-Management.md),
[ADR-0007](./ADR-0007-Backup-Format-And-Offload.md),
[ADR-0013](./ADR-0013-App-Lock-Key-Release-And-Protected-Albums.md), and
[ADR-0016](./ADR-0016-Isolated-Encrypted-Interop-Transports.md); it does not
rewrite any of them. It governs one cluster of four child work items:
native drag-out, a read-only macOS File Provider, an explicit Apple Photos
(PhotoKit) bridge, and Finder library identity.

## Context

Overlook keeps everything as offline ciphertext: SQLCipher records and
content-addressed blob envelopes ([ADR-0004](./ADR-0004-Encryption-And-Key-Management.md)),
released only while the library is open and refused wholesale while locked
([ADR-0013](./ADR-0013-App-Lock-Key-Release-And-Protected-Albums.md)).
Cross-product interoperability already established that plaintext egress uses a
signed native boundary with no browser-only or unsigned fallback
([ADR-0016](./ADR-0016-Isolated-Encrypted-Interop-Transports.md)).

The epic asks Overlook to behave like a native macOS photo source across
browsers, Finder, and Apple Photos: drag photos into other apps, pick them from
standard Open/upload dialogs, and import/export through PhotoKit. Every one of
those channels must hand **real decrypted bytes** to macOS or to a receiving
application. That crosses the plaintext-custody boundary the four ADRs above
defend, and it does so through OS surfaces Overlook does not fully control: a
macOS File Provider and the drag/`NSItemProvider` pasteboard can **materialize
and cache originals on local disk outside Overlook's eviction authority**. A
single decision must define that boundary — when plaintext may leave, whether
macOS may cache it, how it is cleaned up, and how locking, protected albums,
offloaded originals, signing, and extension isolation apply — before any child
implementation starts.

## Decision

### 1. Custody principle: explicit, per-item, foreground egress only

Plaintext leaves Overlook **only** in response to a foreground, user-initiated
transfer that names the payload, to a destination the user chose in that same
action. There is no ambient, standing, or background access; no localhost API
and no general browser-extension reach (both out of scope). The only four
egress channels are the four child surfaces below. Every other path — backup,
sync, provider storage, diagnostics — remains ciphertext under the existing
ADRs. Anything not enumerated here does not get plaintext.

### 2. The egress gate

A channel may materialize plaintext for an item only when **all** hold:

- a foreground user action selected that specific item (drag, Open-dialog pick,
  or explicit PhotoKit import/export — never a passive enumeration);
- the library is `Unlocked` in the [ADR-0013](./ADR-0013-App-Lock-Key-Release-And-Protected-Albums.md)
  state machine;
- the item is **not** in a protected-album domain (protected content is out of
  scope for the first slice and stays absent from every channel);
- the item's original is available, or can be rehydrated under live authority
  (section 6).

Materialization is per-selected-item, lazy, and minimal: only the bytes the
receiving application actually accepts are produced. Selecting nothing
materializes nothing.

### 3. Materialization and macOS caching — honest disclosure

**We do not claim plaintext is memory-only.** Where an OS API owns the
materialized copy — the File Provider domain's on-disk working set, a drag file
promise fulfilled into another app's sandbox, a PhotoKit asset written into the
Apple Photos library — macOS or the receiving app can retain a local copy that
Overlook cannot reach or delete. This is disclosed, not hidden.

Where the API lets Overlook own the materialized file, it writes plaintext to a
per-transfer scratch location under its own control and evicts it (section 4).
Where macOS owns the copy, Overlook requests eviction where the API allows and
treats any OS- or peer-retained copy as **outside its guarantee**. Before a user
enables OS-wide access (File Provider registration, Finder identity), the UI
must disclose in plain language that macOS may keep copies of photos shared this
way. Consent is explicit and revocable.

### 4. Cleanup and eviction guarantees

- **Overlook-owned scratch:** created per transfer, `unlink`ed on completion or
  cancellation, and swept on unlock, launch, and lock. No plaintext scratch
  survives a lock transition.
- **File Provider working set:** on lock, disable, or disconnect, Overlook
  requests eviction of materialized items through the provider API. It does not
  claim this deletes copies other applications already imported.
- **Disable / uninstall:** Overlook removes its File Provider domain
  registration, Finder/UTType registration, and its own caches. Copies that
  other apps or Apple Photos already received are theirs; Overlook makes no
  false cleanup claim about them. Signed packaged acceptance verifies install,
  upgrade, disable/disconnect, and uninstall cleanup of Overlook-owned state.

### 5. App-lock and protected-album behavior (extends ADR-0013)

While `Locked`, `Locking`, `Unlocking`, or `RecoveryRequired`, all four channels
fail closed with no leakage beyond the adopted metadata policy:

- drag produces nothing;
- the File Provider returns the same generic unavailable response for **every**
  id — no names, EXIF, counts, thumbnails, or bytes — mirroring the
  `overlook-thumb://` / `overlook-full://` locked behavior;
- PhotoKit import/export refuse;
- Finder Quick Look shows only the static privacy-safe summary (section 7),
  never per-photo content.

Entering `Locking` aborts in-flight materializations, unlinks Overlook-owned
scratch, and requests File Provider eviction as part of the existing
cache/object-URL teardown. Protected-domain photos are **absent** from every
channel — not enumerated, no stable ids, no thumbnails — matching ADR-0013's
minimal-leakage policy. Unavailable content fails closed the same way.

### 6. Offloaded-original retrieval (extends ADR-0007)

The File Provider represents an offloaded original as a **dataless item** that
materializes on demand; it never fabricates bytes or reports an offloaded
original as locally available. When any channel needs an offloaded original, it
triggers an authorized rehydrate under a live library authority generation
before materializing. If rehydrate fails, is cancelled, or the authority is
revoked mid-flight, the channel fails closed and materializes nothing. Drag and
PhotoKit export follow the same rule.

### 7. Adopted metadata policy and read-only invariant

The File Provider and Finder surfaces may expose, for **enabled, unlocked,
non-protected** items only: a stable item identifier, file name, size, content
type, and modification date, plus a thumbnail. The Quick Look summary is
**library-level and privacy-safe** (e.g. library name and item count); it never
renders per-photo thumbnails of locked or protected content and never reveals
protected album names, memberships, or counts.

Encrypted internals — the SQLCipher database, blob envelopes, key records,
`master.key` / OVLK custody, anchors — are **never** exposed as ordinary photo
files, never enumerated by the provider, and never documented as photo storage.
A `.photoslibrary` database is neither read nor fabricated (out of scope).

The File Provider is **strictly read-only**: external rename, write, move, and
delete cannot mutate Overlook. The provider rejects or no-ops write intents and
never maps them onto library mutations. Overlook's main process remains the only
writer of library state.

### 8. Native drag-out boundary

The existing internal photo drag becomes an OS-native file drag built on **file
promises**, so bytes materialize only if and when a receiver accepts the drop,
and only for the user-selected payload (one or many items). Drag never deletes
or mutates the source — cancellation, a rejected drop, or a locked/offloaded
item simply produces no bytes. Protected and locked items are never draggable.
Offloaded originals rehydrate under section 6 or the drag fails closed.

### 9. PhotoKit bridge boundary

A minimal native PhotoKit bridge supports **explicit import and export only**;
bidirectional synchronization is out of scope for this slice. It requests only
the least Photos authorization the operation needs (add-only for export where
the OS supports it; read for import) and never a broader standing scope. It
preserves supported originals and metadata and does **not** claim unsupported
round-trip fidelity. Export into Apple Photos is plaintext leaving Overlook and
obeys the section 2 egress gate in full.

### 10. Authorization, signing, entitlements, extension isolation

The File Provider and any PhotoKit/Quick Look extensions are **separate
signed/notarized bundles** with their own least-privilege entitlements. They do
**not** inherit the main app's key-custody or Keychain identity — mirroring
ADR-0013's rule that renderer/helper inherited entitlements omit the Keychain
identity. An extension reaches library plaintext only across a narrow, typed,
audited boundary to the main process (in the spirit of ADR-0016's dispatcher:
validated frames, exact identity, traversal-free references, no ambient database
or key access), and only for items that are explicitly requested, authorized,
unlocked, and non-protected. There is no unsigned or developer-build fallback
that grants OS-wide access. Finder library identity registers a package/UTType
with an icon and double-click open/focus behavior; the Quick Look generator is a
sandboxed extension that reads only the section 7 privacy-safe summary.

### 11. Disclosure and consent

Before enabling any OS-wide surface (File Provider, Finder identity), Overlook
presents a privacy disclosure covering what leaves, that macOS may retain
materialized copies (section 3), the read-only nature of the provider, and the
lock/protected/offloaded fail-closed behavior. Consent is explicit and revocable
via disable/disconnect, and its lifecycle is part of the acceptance evidence.

## Threat model

| Threat                                                                       | Required response                                                                                                                                         |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drag / File Provider / PhotoKit / Quick Look access while locked             | Every channel fails closed: no bytes, generic unavailable for every id, static privacy-safe Quick Look only.                                              |
| Protected-domain discovery through provider enumeration, thumbnails, or ids  | Protected content is absent from all four channels — no ids, names, counts, or thumbnails, matching ADR-0013 minimal leakage.                             |
| External rename / write / move / delete through Finder mutating Overlook     | Read-only provider rejects or no-ops write intents; no mutation path exists; main process stays the only writer.                                          |
| macOS or a receiving app retaining materialized plaintext after lock/disable | Disclosed, never claimed memory-only; Overlook evicts its own scratch and requests provider eviction, and documents that OS/peer copies are out of scope. |
| Extension compromise reaching keys, database, or ciphertext                  | Separate signed bundle with no inherited custody; narrow audited main-process boundary; per-item authorized plaintext only.                               |
| Offloaded original fabricated or reported as local                           | Dataless items materialize via authorized rehydrate under live authority, or fail closed; bytes are never fabricated.                                     |
| Encrypted internals exposed as photo files or in Quick Look                  | Internals are never enumerated, materialized, or documented as photo storage; Quick Look is a privacy-safe library summary only.                          |
| Unsigned or developer build granting OS-wide access                          | Signing/notarization/entitlement gate with no fallback; unsigned builds cannot register the provider or Finder identity.                                  |

The design does not protect against an application the user deliberately handed
a photo to, a compromised OS/kernel, or screen capture of content the user
authorized. Those limits match ADR-0004's compromised-session boundary.

## Consequences

- Native drag becomes a real OS file-promise drag and PhotoKit/File Provider
  become signed/notarized native extensions; more native code, signing, and
  entitlement management than a renderer-only feature.
- Overlook must disclose honestly that macOS can cache shared plaintext; it
  cannot promise memory-only custody once bytes cross into an OS-owned surface.
- The read-only invariant costs Finder convenience (no external rename/edit) to
  preserve single-writer custody.
- Locked, protected, and offloaded states each add a fail-closed enforcement
  point on four new surfaces, requiring table-driven and packaged acceptance
  tests.
- PhotoKit stays least-privilege and explicit; bidirectional sync is
  deliberately deferred.
- The owner must accept this ADR before any child implementation begins (ADR
  gate). Signed packaged macOS acceptance — install, upgrade, disable/disconnect,
  uninstall cleanup — is required exit evidence for the epic.

## Acceptance mapping

The epic's acceptance scenarios map onto these decisions: drag one/many photos
into a browser upload (§8); pick an Overlook photo from a standard upload dialog
via the File Provider (§7); locked access fails closed without leaking names,
thumbnails, or bytes (§5); protected albums stay absent (§5); PhotoKit
import/export under Photos authorization (§9); double-click library open and
privacy-safe Quick Look (§7, §10); signed packaged install/upgrade/disable/
uninstall cleanup (§4, §11). Executable evidence and the exact File Provider
metadata schema, thumbnail policy, PhotoKit authorization scope per OS version,
UTType identifier, and eviction API specifics are owned by the sequenced child
issues, which cannot start until this ADR is accepted.
