# Spike: Lossless Cold-Storage Archives

## Status

**Complete — no-go (2026-07-20).** Do not add a compressed archive layer to
Overlook's local, offloaded, or backed-up originals. Keep the existing
content-addressed OVLK envelope per original.

This spike investigated `main` at `9e2404b` for
[#507](https://github.com/qwts/photos/issues/507). It changes no product
behavior and mutates no library data.

## Question

Can Overlook save enough space by packing a selected folder or collection into
a lossless cold-storage archive while preserving encryption, exact original
bytes, recovery, random access, deduplication, and acceptable restore cost?

## Answer

No with the current library contract. ZIP, tar+zstd, and a format-aware ZIP all
made the representative OVLK ciphertext corpus larger by 0.08–0.09%. The best
plaintext upper bound, tar+zstd, saved only 5.83% on the mixed corpus before
encryption. Reaching even that smaller result in production would require a new
container encrypted as a unit, which would replace Overlook's per-photo
authentication, content addressing, random access, backup verification, and
failure isolation. The storage benefit does not clear the threshold for that
cost.

## Decision threshold

An archive design must satisfy every row before implementation issues are
opened:

| Dimension               | Go threshold                                                                       | Result                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Net storage             | At least 10% savings on the encrypted mixed corpus; no dominant media family grows | **Fail:** mixed ciphertext grew 0.08–0.09%; every family grew                                 |
| Exact originals         | Byte-identical JPEG, HEIC, RAW, and sidecars after extraction                      | Pass in the probe, but only because no media was transcoded                                   |
| Single-item access      | One item without decrypting or downloading unrelated items                         | ZIP can index members locally; tar+zstd needs an additional seekable framing/index contract   |
| Corruption blast radius | At most one original or one existing 4 MiB OVLK chunk                              | Existing objects pass; an archive introduces shared index/container failure modes             |
| Incremental updates     | No whole-archive rewrite or re-upload for one changed member                       | Fail for tar+zstd and cloud-hosted ZIP; append-only ZIP leaves compaction and stale-byte debt |
| Recovery                | Restore remains manifest + independently verifiable OVLK objects                   | Fail if plaintext is packed before encryption; redundant if ciphertext is packed afterward    |
| Working memory          | Peak below 128 MiB for the measured pack and unpack tools                          | Pass: the highest observed peak was about 12 MiB                                              |

The 10% floor is deliberately modest. Below it, archive metadata, temporary
space, migration, verification, repair, provider transfer, and support costs
can erase the nominal byte saving.

## Method

The reproducible harness is
[`scripts/benchmark-cold-storage.mjs`](../scripts/benchmark-cold-storage.mjs).
Run it on macOS with Info-ZIP, `tar`, and `zstd` available:

```sh
npm run benchmark:cold-storage -- --output docs/benchmarks/cold-storage-2026-07-20.json
```

The checked-in raw result is
[`docs/benchmarks/cold-storage-2026-07-20.json`](./benchmarks/cold-storage-2026-07-20.json).
The harness:

- uses the repository's licensed JPEG, HEIC, RAF, and JSON sidecar fixtures;
- excludes the intentionally corrupt JPEG;
- excludes repeated copies because the BlobStore already deduplicates exact
  plaintext SHA-256 matches;
- normalizes fixture timestamps so archive sizes reproduce byte-for-byte;
- tests plaintext as an optimistic upper bound;
- tests production-shaped OVLK v1 ciphertext with the real 4 MiB chunk,
  header, nonce, AAD, and tag layout described in
  [Library Format v1](./Library-Format-v1.md);
- uses a deterministic, benchmark-only key and per-path nonce prefix solely in
  the temporary directory — never in production custody;
- extracts every archive and byte-compares every member with its input; and
- records archive bytes, pack/unpack wall time, and peak child-process RSS.

The fixture corpus is small (11 files, 3.18 MB mixed) and does not predict
absolute throughput for a large library. It is sufficient for the decisive
property here: whether already-compressed media or authenticated ciphertext has
compressible redundancy. Timing and memory are one-run observations, not a
performance distribution.

## Candidates

### ZIP, Deflate level 9

Each member is independently compressed and indexed by ZIP's central directory.
That provides practical member lookup and extraction, and the format permits a
member to be stored without compression. The tradeoff is duplicated local and
central headers plus a shared end-of-archive directory. ZIP's CRC32 detects
accidental damage but is not a replacement for OVLK authentication.

Specification:
[PKWARE APPNOTE 6.3.10](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT).

### tar + Zstandard level 3

This is the best plaintext compressor in the probe because a solid stream can
reuse redundancy across file boundaries. Ordinary tar+zstd is sequential. A
random-access design would need independently compressed frames plus a seek
table; that becomes a new container and recovery contract rather than a choice
of compression command.

Specifications:
[Zstandard format](https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md),
[Zstandard seekable format](https://github.com/facebook/zstd/blob/dev/contrib/seekable_format/zstd_seekable_compression_format.md).

### Format-aware ZIP

The low-risk format-aware candidate stores JPEG, HEIC, and RAW members without
recompression and Deflates JSON sidecars. This avoids wasting CPU on formats
that are already compressed while retaining ZIP member lookup. After OVLK
encryption every member is opaque and high entropy, so the only honest policy
is store-only. Codec conversion such as lossless JPEG recompression was not
treated as an archive method: it would replace the user's exact original bytes,
violating the preservation and recovery contract.

## Results

### Mixed corpus

Positive savings means a smaller archive. Negative savings means growth.

| Representation | Method           | Input bytes | Archive bytes | Savings |   Pack | Unpack | Peak RSS |
| -------------- | ---------------- | ----------: | ------------: | ------: | -----: | -----: | -------: |
| Plaintext      | ZIP Deflate 9    |   3,175,945 |     3,158,759 |   0.54% | ~70 ms | ~24 ms |  ~2.5 MB |
| Plaintext      | tar + zstd 3     |   3,175,945 |     2,990,840 |   5.83% | ~24 ms | ~21 ms |   ~12 MB |
| Plaintext      | format-aware ZIP |   3,175,945 |     3,171,218 |   0.15% | ~24 ms | ~23 ms |  ~2.5 MB |
| OVLK envelope  | ZIP Deflate 9    |   3,176,407 |     3,179,317 |  -0.09% | ~64 ms | ~22 ms |  ~2.5 MB |
| OVLK envelope  | tar + zstd 3     |   3,176,407 |     3,178,831 |  -0.08% | ~25 ms | ~21 ms |   ~12 MB |
| OVLK envelope  | format-aware ZIP |   3,176,407 |     3,178,817 |  -0.08% | ~15 ms | ~22 ms |  ~2.5 MB |

Times are rounded orientation only; the JSON artifact is authoritative for the
recorded run.

### OVLK family results

| Corpus  | ZIP Deflate 9 | tar + zstd 3 | Format-aware ZIP |
| ------- | ------------: | -----------: | ---------------: |
| JPEG    |        -0.11% |       -0.21% |           -0.09% |
| HEIC    |        -0.04% |       -0.06% |           -0.03% |
| RAW     |        -0.20% |       -0.39% |           -0.18% |
| Sidecar |        -5.16% |       -4.93% |           -5.16% |
| Mixed   |        -0.09% |       -0.08% |           -0.08% |

Plaintext sidecars compressed by about 76–78%, but they are only 8.6 KB of the
3.18 MB corpus. Their encrypted envelopes grew because authenticated ciphertext
does not retain that redundancy. JPEG supplied the only material plaintext
cross-file saving (11.01% with solid tar+zstd); HEIC and RAF plaintext remained
within 1.73% of their source sizes.

## Architecture tradeoffs

### Existing encrypted objects inside an archive

This preserves plaintext custody and the inner OVLK authentication boundary,
but it cannot save space. It also creates a second index and lifecycle above
objects the database and manifest already address individually. A damaged
archive directory or frame can make several otherwise healthy objects hard to
locate, while each object still needs its own authentication and content-hash
verification after extraction.

### Plaintext packed before encryption

This is the only placement where cross-file compression can work, and the probe
still found only 5.83% on mixed data. It would require a new authenticated
container, key/AAD version, index, restore reader, migration, partial extraction
cache, cancellation journal, and repair tool. One member update changes the
container ciphertext from that point forward and defeats the current
content-addressed dedupe and per-photo backup ledger.

Plaintext must never be staged to disk to build such a container. A streaming
implementation could avoid that specific leak, but it would not solve the
shared blast radius, update amplification, or provider contract.

### Provider behavior

Overlook currently uploads and verifies each OVLK object independently. Google
Drive supports resumable chunks within one uploaded file, which helps an
interrupted transfer but does not make interior archive members independent.
pCloud's upload endpoint likewise uploads a file and preserves overwritten
content as a revision. Packing many photos into one provider object therefore
makes one changed member a new whole-object upload/version and expands retry,
quota, and repair scope.

Provider references:
[Google Drive resumable uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads),
[pCloud `uploadfile`](https://docs.pcloud.com/methods/file/uploadfile.html).

## Recommendation

1. Keep originals as independent, content-addressed OVLK envelopes locally and
   remotely. ADR-0007's encrypt-once/upload-as-is contract remains the correct
   cold-custody primitive.
2. Do not add ZIP, tar+zstd, or a new authenticated archive container to the
   library format.
3. Do not compress plaintext metadata separately inside original custody; its
   contribution is too small and manifests already carry recoverable metadata.
4. Treat future “cold storage” as a placement policy for the same verified OVLK
   objects — external disk or provider tiering — not as compression.
5. Open no implementation follow-ups from this spike.

## Reopen conditions

Revisit only if at least one premise changes:

- a representative, consented, substantially larger corpus demonstrates at
  least 10% net savings after the complete encrypted container is counted;
- a provider offers independently addressable, verifiable sub-objects that do
  not require whole-container replacement;
- the product deliberately adopts a non-byte-identical “optimized original”
  contract through a new ADR; or
- a new media family is both common and materially compressible without
  changing exact source bytes.

Any reopened spike must include corruption injection, interrupted incremental
updates, partial extraction, offload/restore, and disaster-recovery evidence —
not compression ratios alone.
