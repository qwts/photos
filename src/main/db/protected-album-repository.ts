import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

import { inspectProtectedAlbumCredentialRecord, type ProtectedAlbumContext } from '../crypto/protected-album-credentials.js';
import { queryAll, queryGet, runNamed } from './sql.js';

export type ProtectedAlbumMigrationState = 'staged' | 'active' | 'retiring';

export interface ProtectedAlbumStoredRecord {
  readonly albumId: string;
  readonly migrationState: ProtectedAlbumMigrationState;
  readonly credentialGeneration: number;
  readonly metadataGeneration: number;
  readonly credentialRecord: Buffer;
  readonly sealedMetadata: Buffer;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ProtectedAlbumRow {
  readonly albumId: string;
  readonly migrationState: ProtectedAlbumMigrationState;
  readonly credentialGeneration: number;
  readonly metadataGeneration: number;
  readonly credentialRecord: Buffer;
  readonly sealedMetadata: Buffer;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class ProtectedAlbumRepositoryError extends Error {
  override readonly name = 'ProtectedAlbumRepositoryError';
}

function copyRow(row: ProtectedAlbumRow): ProtectedAlbumStoredRecord {
  return { ...row, credentialRecord: Buffer.from(row.credentialRecord), sealedMetadata: Buffer.from(row.sealedMetadata) };
}

export class ProtectedAlbumRepository {
  constructor(
    private readonly db: BetterSqlite3.Database,
    private readonly libraryId: string,
  ) {
    if (libraryId.length < 1 || libraryId.length > 256) throw new ProtectedAlbumRepositoryError('library id is invalid');
  }

  insertStaged(input: {
    readonly albumId: string;
    readonly credentialRecord: Buffer;
    readonly sealedMetadata: Buffer;
    readonly now?: string;
  }): ProtectedAlbumStoredRecord {
    const context = this.context(input.albumId);
    const generations = inspectProtectedAlbumCredentialRecord(context, input.credentialRecord);
    const now = input.now ?? new Date().toISOString();
    runNamed(
      this.db,
      `INSERT INTO protected_album_records (
         album_id, record_version, migration_state, credential_generation,
         metadata_generation, credential_record, sealed_metadata, created_at, updated_at
       ) VALUES (
         @albumId, 1, 'staged', @credentialGeneration,
         @metadataGeneration, @credentialRecord, @sealedMetadata, @createdAt, @updatedAt
       )`,
      {
        albumId: input.albumId,
        credentialGeneration: generations.passwordGeneration,
        metadataGeneration: generations.metadataGeneration,
        credentialRecord: input.credentialRecord,
        sealedMetadata: input.sealedMetadata,
        createdAt: now,
        updatedAt: now,
      },
    );
    const inserted = this.get(input.albumId);
    if (inserted === undefined) throw new ProtectedAlbumRepositoryError('protected album insert did not persist');
    return inserted;
  }

  get(albumId: string): ProtectedAlbumStoredRecord | undefined {
    const row = queryGet<ProtectedAlbumRow>(
      this.db,
      `SELECT album_id AS albumId, migration_state AS migrationState,
              credential_generation AS credentialGeneration, metadata_generation AS metadataGeneration,
              credential_record AS credentialRecord, sealed_metadata AS sealedMetadata,
              created_at AS createdAt, updated_at AS updatedAt
         FROM protected_album_records WHERE album_id = ?`,
      albumId,
    );
    return row === undefined ? undefined : copyRow(row);
  }

  listOpaque(): readonly { readonly albumId: string; readonly migrationState: ProtectedAlbumMigrationState }[] {
    return queryAll<{ albumId: string; migrationState: ProtectedAlbumMigrationState }>(
      this.db,
      `SELECT album_id AS albumId, migration_state AS migrationState
         FROM protected_album_records ORDER BY album_id`,
    );
  }

  replaceCredentials(input: {
    readonly albumId: string;
    readonly expectedCredentialRecord: Buffer;
    readonly credentialRecord: Buffer;
    readonly now?: string;
  }): boolean {
    const context = this.context(input.albumId);
    const generations = inspectProtectedAlbumCredentialRecord(context, input.credentialRecord);
    const row = queryGet<{ albumId: string }>(
      this.db,
      `UPDATE protected_album_records
          SET credential_generation = ?, metadata_generation = ?, credential_record = ?, updated_at = ?
        WHERE album_id = ? AND credential_record = ?
        RETURNING album_id AS albumId`,
      generations.passwordGeneration,
      generations.metadataGeneration,
      input.credentialRecord,
      input.now ?? new Date().toISOString(),
      input.albumId,
      input.expectedCredentialRecord,
    );
    return row !== undefined;
  }

  transition(
    albumId: string,
    from: ProtectedAlbumMigrationState,
    to: ProtectedAlbumMigrationState,
    now = new Date().toISOString(),
  ): boolean {
    this.context(albumId);
    const row = queryGet<{ albumId: string }>(
      this.db,
      `UPDATE protected_album_records SET migration_state = ?, updated_at = ?
        WHERE album_id = ? AND migration_state = ? RETURNING album_id AS albumId`,
      to,
      now,
      albumId,
      from,
    );
    return row !== undefined;
  }

  deleteStaged(albumId: string): boolean {
    this.context(albumId);
    return (
      queryGet<{ albumId: string }>(
        this.db,
        `DELETE FROM protected_album_records WHERE album_id = ? AND migration_state = 'staged' RETURNING album_id AS albumId`,
        albumId,
      ) !== undefined
    );
  }

  private context(albumId: string): ProtectedAlbumContext {
    if (albumId.length < 1 || albumId.length > 256) throw new ProtectedAlbumRepositoryError('album id is invalid');
    return { libraryId: this.libraryId, albumId };
  }
}
