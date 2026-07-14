import { z } from 'zod';

export const BACKUP_MANIFEST_SCHEMA_VERSION = 2 as const;

const ulidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/u, 'expected a Crockford ULID');
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u, 'expected a lowercase SHA-256 digest');
const isoTimestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'expected an ISO timestamp');
const keyIdSchema = z.number().int().positive();

const legacyPhotoSchema = z.strictObject({
  id: z.string().min(1),
  contentHash: sha256Schema,
  bytes: z.number().int().nonnegative(),
  fileName: z.string().min(1),
  keyId: keyIdSchema,
});

export const backupManifestV1Schema = z.strictObject({
  schema: z.literal(1),
  rows: z.array(legacyPhotoSchema).readonly(),
});

export const backupManifestPhotoV2Schema = z.strictObject({
  id: z.string().min(1),
  fileName: z.string().min(1),
  fileKind: z.enum(['jpeg', 'raw', 'png', 'heic', 'other']),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  contentHash: sha256Schema,
  blobPath: z.string().min(1),
  camera: z.string().nullable(),
  lens: z.string().nullable(),
  iso: z.number().int().positive().nullable(),
  aperture: z.string().nullable(),
  shutter: z.string().nullable(),
  focalLength: z.number().nonnegative().nullable(),
  takenAt: z.string().nullable(),
  gpsLat: z.number().min(-90).max(90).nullable(),
  gpsLon: z.number().min(-180).max(180).nullable(),
  place: z.string().nullable(),
  importedAt: isoTimestampSchema,
  importSource: z.string().min(1),
  favorite: z.boolean(),
  keyId: keyIdSchema,
  deletedAt: z.string().nullable(),
});

export const backupManifestAlbumV2Schema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: isoTimestampSchema,
  position: z.number().int().nonnegative(),
  photoIds: z.array(z.string().min(1)).readonly(),
});

export const backupManifestV2Schema = z
  .strictObject({
    schema: z.literal(BACKUP_MANIFEST_SCHEMA_VERSION),
    libraryId: ulidSchema,
    databaseSchema: z.number().int().positive(),
    generatedAt: isoTimestampSchema,
    keyIds: z.array(keyIdSchema).min(1).readonly(),
    totals: z.strictObject({
      photos: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
      albums: z.number().int().nonnegative(),
    }),
    photos: z.array(backupManifestPhotoV2Schema).readonly(),
    albums: z.array(backupManifestAlbumV2Schema).readonly(),
  })
  .superRefine((manifest, context) => {
    const keyIds = new Set(manifest.keyIds);
    if (keyIds.size !== manifest.keyIds.length) {
      context.addIssue({ code: 'custom', path: ['keyIds'], message: 'key IDs must be unique' });
    }

    const photoIds = new Set<string>();
    let bytes = 0;
    for (const [index, photo] of manifest.photos.entries()) {
      if (photoIds.has(photo.id)) {
        context.addIssue({ code: 'custom', path: ['photos', index, 'id'], message: 'photo IDs must be unique' });
      }
      photoIds.add(photo.id);
      bytes += photo.bytes;
      if (!keyIds.has(photo.keyId)) {
        context.addIssue({ code: 'custom', path: ['photos', index, 'keyId'], message: 'photo key is missing from keyIds' });
      }
      const expectedPath = `blobs/${photo.contentHash.slice(0, 2)}/${photo.contentHash}`;
      if (photo.blobPath !== expectedPath) {
        context.addIssue({ code: 'custom', path: ['photos', index, 'blobPath'], message: 'blob path does not match the content hash' });
      }
    }

    const albumIds = new Set<string>();
    for (const [albumIndex, album] of manifest.albums.entries()) {
      if (albumIds.has(album.id)) {
        context.addIssue({ code: 'custom', path: ['albums', albumIndex, 'id'], message: 'album IDs must be unique' });
      }
      albumIds.add(album.id);
      const members = new Set<string>();
      for (const [memberIndex, photoId] of album.photoIds.entries()) {
        if (!photoIds.has(photoId)) {
          context.addIssue({
            code: 'custom',
            path: ['albums', albumIndex, 'photoIds', memberIndex],
            message: 'album member is missing from photos',
          });
        }
        if (members.has(photoId)) {
          context.addIssue({
            code: 'custom',
            path: ['albums', albumIndex, 'photoIds', memberIndex],
            message: 'album members must be unique',
          });
        }
        members.add(photoId);
      }
    }

    if (manifest.totals.photos !== manifest.photos.length) {
      context.addIssue({ code: 'custom', path: ['totals', 'photos'], message: 'photo total does not match photos' });
    }
    if (manifest.totals.bytes !== bytes) {
      context.addIssue({ code: 'custom', path: ['totals', 'bytes'], message: 'byte total does not match photos' });
    }
    if (manifest.totals.albums !== manifest.albums.length) {
      context.addIssue({ code: 'custom', path: ['totals', 'albums'], message: 'album total does not match albums' });
    }
  });

export type BackupManifestV1 = z.infer<typeof backupManifestV1Schema>;
export type BackupManifestV2 = z.infer<typeof backupManifestV2Schema>;

export type ParsedBackupManifest =
  { readonly restorable: false; readonly manifest: BackupManifestV1 } | { readonly restorable: true; readonly manifest: BackupManifestV2 };

export class BackupManifestError extends Error {
  override readonly name = 'BackupManifestError';
}

export function parseBackupManifest(input: unknown): ParsedBackupManifest {
  const version = z.object({ schema: z.number().int() }).safeParse(input);
  if (!version.success) {
    throw new BackupManifestError('manifest is missing a numeric schema version');
  }
  if (version.data.schema === 1) {
    const parsed = backupManifestV1Schema.safeParse(input);
    if (!parsed.success) {
      throw new BackupManifestError(`invalid schema-1 manifest: ${z.prettifyError(parsed.error)}`);
    }
    return { restorable: false, manifest: parsed.data };
  }
  if (version.data.schema === BACKUP_MANIFEST_SCHEMA_VERSION) {
    const parsed = backupManifestV2Schema.safeParse(input);
    if (!parsed.success) {
      throw new BackupManifestError(`invalid schema-2 manifest: ${z.prettifyError(parsed.error)}`);
    }
    return { restorable: true, manifest: parsed.data };
  }
  throw new BackupManifestError(`unsupported manifest schema ${String(version.data.schema)}`);
}
