# ADR-0011: Provider Catalog, Capabilities, and Safe Switching

## Status

Accepted (2026-07-14 on
[#280](https://github.com/qwts/photos/issues/280), implemented by merged
[PR #298](https://github.com/qwts/photos/pull/298)).

**Amended 2026-07-22 by
[ADR-0028](./ADR-0028-Remote-Custody-Binding-And-Custody-Safe-Disconnect.md)
(#723):** disconnect and switch are additionally custody-gated — the
active-work rejection below still applies, but a provider/account holding
sole remote custody of offloaded originals cannot be removed through the
ordinary path until those originals are restored and verified locally, and
custody operations for bound rows are addressed by the recorded authority,
never by the current selection.

## Context

The backup and restore engines already depend on `StorageProvider`, but the
settings schema, IPC calls, connection card, quota display, and library chrome
still encode pCloud assumptions. Adding Google Drive or iCloud Drive would
therefore require edits across unrelated product surfaces and could fabricate
capabilities those providers do not expose.

## Decision

Each adapter registers a stable lowercase provider ID, display label, custody
hooks, and an explicit capability descriptor. Capabilities state quota
availability, server-checksum versus download-hash verification, resumable
upload support, supported platforms, interactive authentication, and reconnect
requirements.

Provider list, status, connect, and disconnect IPC calls are provider-addressed.
The renderer consumes descriptors and never owns credentials or adapter policy.
Quota values are nullable and the UI says when usage is not reported. Provider
switching and disconnect are rejected while backup or restore work is active.
An unknown or unavailable persisted provider ID reads as disconnected; it never
falls through to another remote authority.

Credentials remain sealed in provider-owned main-process custody. Adding an
adapter requires its descriptor, adapter, custody hooks, and shared contract
tests; engines and unrelated renderer surfaces remain unchanged.

## Consequences

- Restore onboarding can enumerate providers through the same contract.
- Discovery exposes only completed recovery homes; blob-only uploads and empty
  scratch folders are not mislabeled as corrupt libraries.
- Google Drive and iCloud Drive can report honest platform and capability
  differences without special-case UI branches.
- Providers without quota or server checksum support remain usable but must
  disclose the limitation and use download-hash verification.
- Switching requires an explicit disconnect/connect sequence and waits for
  active work to settle.

Implementation and live-validation status is canonical in the
[Cloud Provider Contract Matrix](../Provider-Contract-Matrix.md). Every new adapter
must pass both shared restore contracts before its restore capability is marked
available.
