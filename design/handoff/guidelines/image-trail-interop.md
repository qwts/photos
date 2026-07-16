# Overlook and Image Trail interoperability

The previous import-only/plaintext recommendation is superseded.

Canonical architecture:
[ADR-0014 — Image Trail Bidirectional Interoperability](https://github.com/qwts/photos/wiki/ADR-0014-Image-Trail-Bidirectional-Interoperability)

Canonical machine-readable contract:
[`design/handoff/contracts/v1/`](../contracts/v1/)

The runtime schemas live under `src/shared/interop/`. Image Trail adopts the
published v1 schemas, fixtures, and checksum exactly; native record translation
is implemented separately in each product.
