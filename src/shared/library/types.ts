// Library record shapes shared across processes (#69). Pure types — the
// renderer imports these for grid/list/inspector rendering; the repository
// and (later) the IPC service speak them natively.

export type FileKind = 'jpeg' | 'raw' | 'png' | 'heic' | 'other';

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
}

export type PhotoInsert = Omit<PhotoRecord, 'favorite' | 'deletedAt'> & {
  readonly favorite?: boolean;
};

/** The sidebar's library sources (design §Sidebar). */
export type SourceFilter = 'all' | 'favorites' | 'recent' | 'offloaded' | 'deleted';

export interface PageCursor {
  /** COALESCE(taken_at, imported_at) of the last row of the previous page. */
  readonly sortKey: string;
  readonly id: string;
}

export interface PageRequest {
  readonly source: SourceFilter;
  readonly limit: number;
  readonly cursor?: PageCursor;
  /** 'recent' cutoff (ISO); callers own the "recent" window policy. */
  readonly recentSince?: string;
}

export interface PageResult {
  readonly photos: readonly PhotoRecord[];
  readonly nextCursor: PageCursor | null;
}

export type SourceCounts = Readonly<Record<SourceFilter, number>>;
