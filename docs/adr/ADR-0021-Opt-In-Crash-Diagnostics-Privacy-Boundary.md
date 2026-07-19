# ADR-0021 — Opt-In Crash Diagnostics Privacy Boundary

**Status:** Accepted for local collection; transmission deferred  
**Date:** 2026-07-17  
**Issues:** [#286](https://github.com/qwts/photos/issues/286), [#435](https://github.com/qwts/photos/issues/435)

## Context

The Privacy pane had a persisted `shareDiagnostics` placeholder, but no
collector or reporting pipeline. Its copy promised local-only behavior. That
legacy preference is not informed consent to a future network recipient.
Crash minidumps and arbitrary JavaScript errors are also unsafe inputs: either
can contain photo bytes, filenames, local paths, metadata, credentials, or
other process memory.

## Decision

### Consent

- Diagnostics remain off by default.
- Consent is versioned. The current contract is version 1.
- A legacy `shareDiagnostics: true` record without the current consent version
  is reconciled to off. The user must opt in again against current copy.
- Turning the preference off immediately purges pending local reports without
  decrypting them.
- Collection constructs no event identifier or timestamp while consent is off.

### Data contract

- Collection is allowlist-only and schema-versioned. Unknown fields fail
  closed; there is no blacklist redactor.
- Version 1 contains only a random report ID, capture time, app version,
  platform/architecture, a closed process-health event kind, a closed Electron
  termination reason, and an optional numeric exit code.
- Error messages, stacks, renderer URLs, minidumps, arbitrary context, photo
  bytes, thumbnails, EXIF, filenames, library IDs, local paths, search text,
  OAuth tokens, encryption material, and face data are forbidden.
- Native minidumps are not collected. Debug-symbol upload is also disabled
  until the backend decision defines custody and access.

### Local custody

- Reports are sealed with Electron `safeStorage`; unavailable OS keychain
  encryption means no collection and no plaintext fallback.
- Writes are ciphertext-only and atomic.
- Default local bounds are seven days, 50 reports, and 10 MiB. Oldest reports
  are removed first; corrupt or schema-invalid custody is deleted.
- Inspection, export, and upload consume the same exact allowlisted JSON. There
  is no richer hidden payload.

### Transmission gate

No production or placeholder upload endpoint is configured by this ADR.
Transmission remains impossible until [#435](https://github.com/qwts/photos/issues/435)
names and provisions all of the following:

- operator/data-controller identity and contact;
- exact intake and deletion endpoints, or a named vendor;
- processing region, server and backup retention, and deletion SLA;
- least-privilege operator roles and access logging;
- release/debug-symbol custody and retention;
- anonymous deletion-token and abuse-control contracts.

The future transport must be endpoint-injected, make zero requests while
consent is off, retry only encrypted pending reports, and never fall back to an
implicit vendor endpoint.

## Consequences

- The local privacy boundary, encrypted queue, inspection path, and tests can
  ship before backend provisioning.
- Reports are intentionally less detailed than conventional crash telemetry.
  This trades some debugging power for an auditable promise that user content
  and arbitrary process memory never enter the pipeline.
- #286 stays open until runtime capture, user controls, packaged acceptance,
  and the #435 transmission decision are complete.
