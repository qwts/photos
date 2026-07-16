# Overlook and Image Trail interoperability contracts

This directory contains the versioned, distributable contract artifacts used by
Overlook and Image Trail. The runtime schemas live under
`src/shared/interop/`; committed JSON schemas and golden fixtures will be
generated and checksummed here so the sibling repositories can enforce exact
parity without a network dependency during builds.

Contract v1 is tracked by `qwts/photos#331` and `qwts/image-trail#584`.
