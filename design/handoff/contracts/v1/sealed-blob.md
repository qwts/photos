# Sealed original blob v1

The binary file uses two nested length-prefixed frames. Every length is an
unsigned 32-bit big-endian integer and each JSON header is at most 8192 bytes.

Outer frame:

1. Four-byte clear-header length.
2. UTF-8 JSON matching `sealed-blob-header.schema.json`.
3. AES-256-GCM ciphertext followed by its 128-bit authentication tag.

The exact clear-header bytes are AES-GCM additional authenticated data. Only
the format, pairing/key references, and cipher parameters are provider-visible.

Decrypted inner frame:

1. Four-byte descriptor length.
2. UTF-8 JSON matching `sealed-blob-descriptor.schema.json`.
3. Exact original bytes.

The reader must authenticate before parsing the descriptor, then verify the
original byte length and lowercase SHA-256 digest. It must reject unsupported
versions, non-canonical base64, oversized or truncated frames, custody
mismatches, and descriptor/hash mismatches.
