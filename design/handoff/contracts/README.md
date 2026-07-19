# Overlook and Image Trail interoperability contracts

This directory contains the versioned, distributable contract artifacts used by
Overlook and Image Trail. The runtime schemas live under
`src/shared/interop/`; committed JSON schemas, golden fixtures, and
`SHA256SUMS` let the sibling repositories enforce exact parity without a
network dependency during builds.

Run `npm run interop:generate-contract` after an intentional contract change.
Commit the regenerated schemas and checksum with the runtime change. Consumers
must reject unsupported versions and checksum mismatches; they must not silently
fall back to a locally modified contract.

Contract v1 is tracked by `qwts/photos#331` and `qwts/image-trail#584`.
Its architecture decision is canonical in the Photos wiki:
[ADR-0014](../../../docs/adr/ADR-0014-Image-Trail-Bidirectional-Interoperability.md).
