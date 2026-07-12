# Overlook ↔ Image Trail interop

Source of truth: [github.com/qwts/image-trail](https://github.com/qwts/image-trail) (read `README.md` and `DESIGN.md` there first — this doc summarizes only the parts relevant to data interop, current as of this repo's `main` branch). Re-read the real source before implementing; formats can change.

## Why this needs a translation layer, not a shared file format

Image Trail and Overlook are **not the same kind of product**, so their records don't map 1:1:

- **Image Trail** is a browser extension that turns *image URLs on web pages* into navigable trails. Its durable unit is a **bookmark**: a source URL plus optional title/label/dimensions/thumbnail, optionally paired with a **captured original** (raw bytes grabbed from that URL, stored encrypted). There is no camera, no EXIF, no RAW/JPEG pair, no album drag-and-drop the way Overlook has albums — Image Trail has its own lighter-weight "albums" of record IDs.
- **Overlook** is a local desktop photo library ingesting real camera/phone files (RAW+JPEG pairs, full EXIF, multi-GB imports from SD cards).

Treat Image Trail bookmarks as **one possible import source** into a Overlook library (and Overlook exports as one possible thing a user re-imports into Image Trail), not as interchangeable native files. A translation step maps fields and fills in what's missing (no camera/lens/ISO data will ever come from Image Trail).

## Image Trail's real export/backup format (as implemented today)

All Image Trail export files are JSON with this envelope (`encrypted-file-format.ts`):

```
{
  "header": {
    "magic": "IMAGE-TRAIL-EXPORT",
    "formatVersion": 1,
    "payloadType": "history" | "bookmarks" | "mixed" | "keys" | "image",
    "algorithm": "AES-GCM",
    "wrappingMode": "password" | "indexeddb",
    "keyKind": "export" | "blob" | ...,
    "keyReference": "export:<uuid>",
    "salt": "<base64>",
    "iv": "<base64>",
    "iterations": 600000,
    "createdAt": "<ISO 8601>",
    "recordCount": <number>
  },
  "payload": "<base64 AES-GCM ciphertext>"
}
```

Key points:
- Password-wrapped exports derive the AES-GCM key via PBKDF2 with **600,000 iterations** over the given password + `salt` (`crypto/password-wrap.ts`). Anyone with the same password can decrypt — there is no shared secret beyond the password.
- `payloadType: "mixed"` is the **full backup** (`full-backup.ts`), decrypting to:
  ```
  {
    "schemaVersion": 2,
    "bookmarks": [{ "uuid": "...", "payload": DurableBookmarkPayloadV1 }, ...],
    "albums": [{ "id", "name", "createdAt", "updatedAt", "recordIds": [...] }, ...],
    "originalBlobs": [PortableStoredBlobRecord, ...],
    "blobKeyBackups": [...],
    "missingOriginalBlobIds": ["..."]
  }
  ```
- `DurableBookmarkPayloadV1` fields: `url`, `title?`, `label?`, `thumbnail?` (inline preview), `width?`, `height?`, `bookmarkedAt`, `downloadedAt?`, `capturedAt?`, `sourceCompatibility?`, `storedOriginal?` (`{ blobId, mimeType, byteLength, capturedAt }`).
- `PortableStoredBlobRecord` (the actual encrypted original bytes): `id`, `kind: "original"`, `algorithm: "AES-GCM"`, `iv`, `ciphertext` (base64), `encryptedByteLength`, `createdAt`, `key` (key reference), `referenceCount`. The plaintext, once decrypted, is itself `[4-byte big-endian length][JSON metadata: mimeType/byteLength/sourceUrl/capturedAt][raw image bytes]` (`crypto/binary-envelope.ts`) — decrypting a blob is two steps, not one.
- A single decrypted/re-encrypted image can also be exported alone as `payloadType: "image"`, file suffix `*.image-trail-encrypted.json`, payload `{ schemaVersion: 1, mimeType, sourceUrl, fileName, data: <base64> }`.
- An **unencrypted** bookmark/history export also exists: `{ format: "image-trail.records", formatVersion: 1, payloadType, createdAt, recordCount, entries: [{ uuid, payload }] }` — no envelope, no crypto. This is the easiest path for Overlook to read/write.

## Where Image Trail's pCloud backups live

Image Trail connects pCloud via OAuth and uploads full-backup files to a fixed path: **`/Image Trail/backups/`**, filenames ending `*.image-trail-encrypted.json` (`background/pcloud-provider.ts`). It verifies every upload by re-downloading and byte-comparing (or falling back to a SHA-1 checksum call) before trusting it.

**Recommendation for Overlook:** don't write into `/Image Trail/backups/` — that path is Image Trail's own verified-upload target and mixing writers risks a corrupt-looking listing. Use a sibling folder, e.g. `/Image Trail/overlook-imports/` or Overlook's own `/Overlook/` root, and document that a user moving files between the two apps' folders is an explicit, manual step (drag the file over), not a live shared folder.

## Field mapping for a Overlook "Import from Image Trail" flow

| Image Trail field | Maps to Overlook | Notes |
|---|---|---|
| `storedOriginal.blobId` → decrypted blob bytes | photo original bytes | Requires decrypting `PortableStoredBlobRecord` then unwrapping the length-prefixed metadata/bytes envelope. |
| `storedOriginal.mimeType` | file type (RAW/JPEG badge) | Image Trail only ever captures web image formats (JPEG/PNG/WebP/GIF) — never camera RAW. Tag these imports so Overlook doesn't imply RAW provenance. |
| `url` | new **"Source URL"** metadata field | Overlook has no such field today — add one, shown only when present, in the Inspector under a "Web origin" row. |
| `title` / `label` | photo name / caption | Fall back to filename if both absent. |
| `width` / `height` | dimensions | Direct copy. |
| `bookmarkedAt` | import date | Not a capture date — don't conflate with EXIF-style "date taken". |
| `capturedAt` / `downloadedAt` | capture/download timestamp | Show as-is; there's no camera "date taken" to reconcile. |
| `thumbnail` (inline preview) | thumbnail source | Use directly if present; otherwise Overlook generates one after decrypt, same as any import. |
| — (no equivalent) | camera, lens, ISO, aperture, shutter, focal length | **Never populate** — leave the EXIF block empty/hidden for Image-Trail-sourced photos rather than fabricating values. |
| Image Trail "albums" (`recordIds`) | Overlook albums | Map 1:1 by name; create the album if it doesn't exist. |

A photo imported this way should carry a distinct provenance badge (e.g. `Badge tone="neutral"` reading "FROM IMAGE TRAIL" in the Inspector) so it's clear it didn't come from a camera import — same pattern Overlook already uses for `local`/`synced`/`offloaded` status glyphs.

## Reverse direction: Overlook → Image Trail

If Overlook ever exports a library subset back out for Image Trail to import, produce the **plain, unencrypted `image-trail.records` bookmarks envelope** (simplest, no shared-key problem) rather than trying to reproduce Image Trail's password/PBKDF2 envelope from Overlook's own encryption-at-rest scheme (which this design system does not yet define in comparable detail — see `readme.md`'s "encrypted with your key" line). Populate `url` with a `overlook://` or `file://` pseudo-URL identifying the photo if there's no real source URL, and set `sourceCompatibility` only if a real semantic match exists — otherwise omit it rather than guessing.

## What this means for the current UI

No screen changes are required today. When "Import from Image Trail" is actually built:
- It's a new source in the **Import dialog** (alongside "Import from SD card"), not a different dialog shape — same Copy/Move-style options don't apply (nothing to delete from a card), but format (password-encrypted vs. plain `.json`) and a password field would be new fields on that flow.
- Decryption failures (wrong password, corrupt blob, missing referenced blob per `missingOriginalBlobIds`) need their own inline error state — Image Trail's own model already treats a missing blob as "restore as metadata-only," which Overlook's import should mirror (show the record, mark the original unavailable) rather than dropping the row.
