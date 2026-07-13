// Library record shapes shared across processes (#69). Pure types — the
// renderer imports these for grid/list/inspector rendering; the repository
// and (later) the IPC service speak them natively.

export type FileKind = 'jpeg' | 'raw' | 'png' | 'heic' | 'other';

/** sync_ledger.status vocabulary (ADR-0005; 'error' added by #104). */
export type SyncStatus = 'local' | 'syncing' | 'synced' | 'offloaded' | 'error';

export interface PhotoRecord {
  readonly id: string;
  readonly fileName: string;
  readonly fileKind: FileKind;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly contentHash: string;
  readonly camera: string | null;
  readonly lens: string | null;
  readonly iso: number | null;
  readonly aperture: string | null;
  readonly shutter: string | null;
  readonly focalLength: number | null;
  readonly takenAt: string | null;
  readonly gpsLat: number | null;
  readonly gpsLon: number | null;
  readonly place: string | null;
  readonly importedAt: string;
  readonly importSource: string;
  readonly favorite: boolean;
  readonly keyId: number;
  readonly deletedAt: string | null;
  /** From the sync_ledger join; new rows start 'local'. */
  readonly syncState: SyncStatus;
}

export type PhotoInsert = Omit<PhotoRecord, 'favorite' | 'deletedAt' | 'syncState'> & {
  readonly favorite?: boolean;
};

/** The sidebar's library sources (design §Sidebar). */
export type SourceFilter = 'all' | 'favorites' | 'recent' | 'offloaded' | 'deleted';

/** The grid's sort orders (#113): date newest-first, name A→Z, size
 * largest-first (decisions recorded on the PR). */
export type SortOrder = 'date' | 'name' | 'size';

export interface PageCursor {
  /** The active ordering's sort expression at the last row of the previous
   * page — an ISO string (date), lowercased name, or byte count (size). */
  readonly sortKey: string | number;
  readonly id: string;
}

/** Toolbar filter chips (design §Toolbar) — AND-combined. */
export interface ChipFilters {
  readonly favorites?: boolean | undefined;
  readonly raw?: boolean | undefined;
  readonly offloaded?: boolean | undefined;
  readonly localOnly?: boolean | undefined;
}

export interface PageRequest {
  readonly source: SourceFilter;
  readonly limit: number;
  readonly cursor?: PageCursor | undefined;
  /** 'recent' cutoff (ISO); callers own the "recent" window policy. */
  readonly recentSince?: string | undefined;
  /** Case-insensitive substring over name/place/camera (mock semantics). */
  readonly query?: string | undefined;
  readonly chips?: ChipFilters | undefined;
  /** Defaults to 'date' (newest first). */
  readonly order?: SortOrder | undefined;
}

export interface PageResult {
  readonly photos: readonly PhotoRecord[];
  readonly nextCursor: PageCursor | null;
}

export type SourceCounts = Readonly<Record<SourceFilter, number>>;

/** Sidebar albums list (#80); CRUD arrives with M10. */
export interface AlbumSummary {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

export interface LibraryStats {
  readonly photos: number;
  readonly bytes: number;
  /** Dirty ledger rows — drives the backup button/status (#79). */
  readonly pending: number;
  /** Latest verified-backup stamp; null before the first backup (#104). */
  readonly lastBackupAt: string | null;
  /** Bytes whose originals live only in the cloud (#107). */
  readonly offloadedBytes: number;
}
