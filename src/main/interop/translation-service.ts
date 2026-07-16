import type { InteropReviewCategory } from '../../shared/interop/contract.js';
import { interopAlbumSchema, interopRecordSchema, type InteropAlbum, type InteropRecord } from '../../shared/interop/records.js';
import { importImageTrailCompatibilityFile } from './image-trail-compat.js';
import type { ImageTrailCompatibilityImport } from './image-trail-compat.js';
import type { InteropRepository } from './interop-repository.js';
import { deterministicInteropId, translateImageTrailAlbum, translateImageTrailBookmark } from './record-translation.js';

export interface InteropDuplicateLookup {
  hasContentHash(contentHash: string): boolean;
}

export interface InteropRecordImportResult {
  readonly record: InteropRecord;
  readonly reviewCategory: InteropReviewCategory;
  readonly persisted: boolean;
}

export interface InteropCompatibilityImportResult {
  readonly records: readonly InteropRecordImportResult[];
  readonly albums: readonly InteropAlbum[];
  readonly skipped: readonly string[];
  readonly skippedAlbums: readonly string[];
  readonly plaintext: boolean;
}

export interface CanonicalRecordExport {
  readonly record: InteropRecord;
  readonly albums: readonly InteropAlbum[];
  readonly reviewCategory: InteropReviewCategory;
}

export interface CanonicalPayloadImportResult {
  readonly record: InteropRecordImportResult;
  readonly albums: readonly InteropAlbum[];
}

function assertOriginalIdentity(record: InteropRecord): void {
  if (
    record.original.state === 'available' &&
    (record.identity.contentHash === null || record.original.contentHash !== record.identity.contentHash)
  ) {
    throw new Error('Available original content hash does not match interoperability identity.');
  }
}

export class InteropTranslationService {
  constructor(
    private readonly repository: InteropRepository,
    private readonly duplicates: InteropDuplicateLookup,
  ) {}

  previewRecord(input: InteropRecord): InteropReviewCategory {
    const record = interopRecordSchema.parse(input);
    assertOriginalIdentity(record);
    const byOrigin = this.repository.findRecordByOrigin(record.identity.origin.product, record.identity.origin.localId);
    if (byOrigin !== undefined) return byOrigin.record.identity.interopId === record.identity.interopId ? 'duplicate' : 'conflict';
    if (record.identity.contentHash !== null) {
      const matchingInterop = this.repository
        .findRecordsByContentHash(record.identity.contentHash)
        .some((stored) => stored.record.identity.interopId !== record.identity.interopId);
      if (matchingInterop || this.duplicates.hasContentHash(record.identity.contentHash)) return 'duplicate';
    }
    if (record.original.state !== 'available') return 'metadata-only';
    if (!record.original.mimeType.startsWith('image/') || record.original.byteLength === 0 || record.dimensions === null)
      return 'unsupported';
    return 'eligible';
  }

  importRecord(input: { readonly record: InteropRecord; readonly receivedAt: string }): InteropRecordImportResult {
    const record = interopRecordSchema.parse(input.record);
    const reviewCategory = this.previewRecord(record);
    if (reviewCategory === 'conflict') return { record, reviewCategory, persisted: false };
    this.repository.putRecord({ record, reviewCategory, receivedAt: input.receivedAt });
    return { record, reviewCategory, persisted: true };
  }

  importCanonicalPayload(input: {
    readonly record: InteropRecord;
    readonly albums: readonly InteropAlbum[];
    readonly receivedAt: string;
  }): CanonicalPayloadImportResult {
    const record = this.importRecord({ record: input.record, receivedAt: input.receivedAt });
    const albums = input.albums.map((album) => interopAlbumSchema.parse(album));
    if (record.persisted) {
      for (const album of albums) this.repository.putAlbum({ album, receivedAt: input.receivedAt });
    }
    return { record, albums };
  }

  async importCompatibilityFile(input: {
    readonly fileContent: string;
    readonly password?: string | undefined;
    readonly receivedAt: string;
  }): Promise<InteropCompatibilityImportResult> {
    const compatibility = await importImageTrailCompatibilityFile(input.fileContent, input.password);
    return this.persistCompatibility(compatibility, input.receivedAt);
  }

  exportRecord(interopId: string): CanonicalRecordExport | undefined {
    const stored = this.repository.getRecord(interopId);
    if (stored === undefined) return undefined;
    const albums = stored.record.albumIds.flatMap((albumId) => {
      const album = this.repository.getAlbum(albumId);
      return album === undefined ? [] : [album.album];
    });
    return { record: stored.record, albums, reviewCategory: stored.reviewCategory };
  }

  private persistCompatibility(compatibility: ImageTrailCompatibilityImport, receivedAt: string): InteropCompatibilityImportResult {
    const recordIds = new Map(
      compatibility.entries.map((entry) => [entry.uuid, deterministicInteropId('image-trail', entry.uuid)] as const),
    );
    const translatedAlbums = compatibility.albums.map((album) => translateImageTrailAlbum(album, recordIds));
    const albumIdsByRecord = new Map<string, string[]>();
    for (const album of compatibility.albums) {
      const albumInteropId = deterministicInteropId('image-trail-album', album.id);
      for (const localRecordId of album.recordIds) {
        if (!recordIds.has(localRecordId)) continue;
        const ids = albumIdsByRecord.get(localRecordId) ?? [];
        ids.push(albumInteropId);
        albumIdsByRecord.set(localRecordId, ids);
      }
    }
    const records = compatibility.entries.map((entry) =>
      this.importRecord({
        record: translateImageTrailBookmark(entry, { albumIds: albumIdsByRecord.get(entry.uuid) }),
        receivedAt,
      }),
    );
    const persistedRecordIds = new Set(records.filter((result) => result.persisted).map((result) => result.record.identity.interopId));
    const albums = translatedAlbums.map((album) =>
      interopAlbumSchema.parse({
        ...album,
        members: album.members.filter((member) => persistedRecordIds.has(member.recordInteropId)),
      }),
    );
    for (const album of albums) {
      this.repository.putAlbum({ album, receivedAt });
    }
    return {
      records,
      albums,
      skipped: compatibility.skipped,
      skippedAlbums: compatibility.skippedAlbums,
      plaintext: compatibility.plaintext,
    };
  }
}
