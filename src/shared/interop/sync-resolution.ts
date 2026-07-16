import type { InteropConflictAction, InteropProduct, InteropRevisionVector } from './contract.js';
import type { InteropRecord } from './records.js';
import { compareInteropRevisions, mergeInteropRevisions } from './revisions.js';

export const SYNC_FIELDS = [
  'title',
  'label',
  'sourceUrl',
  'dimensions',
  'thumbnail',
  'timestamps',
  'original',
  'albums',
  'sourceCompatibility',
  'roundTripMetadata',
  'deleted',
] as const;

export type SyncField = (typeof SYNC_FIELDS)[number];

export interface SyncConflict {
  readonly field: SyncField;
  readonly imageTrailRevision: InteropRevisionVector;
  readonly overlookRevision: InteropRevisionVector;
}

export interface SyncAnalysis {
  readonly category: 'eligible' | 'duplicate' | 'conflict' | 'delete-review';
  readonly merged: InteropRecord;
  readonly conflicts: readonly SyncConflict[];
}

export interface SyncApplyOutcome {
  readonly primary: InteropRecord;
  readonly secondary: InteropRecord | null;
}

function fieldRevision(record: InteropRecord, field: SyncField): InteropRevisionVector {
  return record.fieldRevisions[field] ?? record.revision;
}

function fieldValue(record: InteropRecord, field: SyncField): unknown {
  switch (field) {
    case 'albums':
      return record.albumIds;
    case 'deleted':
      return record.deletedAt;
    default:
      return record[field];
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyField(record: InteropRecord, source: InteropRecord, field: SyncField): InteropRecord {
  switch (field) {
    case 'albums':
      return { ...record, albumIds: source.albumIds };
    case 'deleted':
      return { ...record, deletedAt: source.deletedAt };
    default:
      return { ...record, [field]: source[field] };
  }
}

function withMergedRevisions(record: InteropRecord, imageTrail: InteropRecord, overlook: InteropRecord): InteropRecord {
  const fieldRevisions = { ...record.fieldRevisions };
  for (const field of SYNC_FIELDS) {
    fieldRevisions[field] = mergeInteropRevisions(fieldRevision(imageTrail, field), fieldRevision(overlook, field));
  }
  return {
    ...record,
    revision: mergeInteropRevisions(imageTrail.revision, overlook.revision),
    fieldRevisions,
  };
}

function recordForProduct(product: InteropProduct, imageTrail: InteropRecord, overlook: InteropRecord): InteropRecord {
  return product === 'image-trail' ? imageTrail : overlook;
}

export function analyzeSyncRecords(imageTrail: InteropRecord, overlook: InteropRecord): SyncAnalysis {
  if (imageTrail.identity.interopId !== overlook.identity.interopId) {
    throw new Error('Sync records must share one canonical interoperability identity.');
  }
  if (sameValue(imageTrail, overlook)) {
    return { category: 'duplicate', merged: imageTrail, conflicts: [] };
  }

  let merged = imageTrail;
  const conflicts: SyncConflict[] = [];
  for (const field of SYNC_FIELDS) {
    const imageTrailRevision = fieldRevision(imageTrail, field);
    const overlookRevision = fieldRevision(overlook, field);
    const relation = compareInteropRevisions(imageTrailRevision, overlookRevision);
    const valuesMatch = sameValue(fieldValue(imageTrail, field), fieldValue(overlook, field));
    if (valuesMatch || relation === 'after') continue;
    if (relation === 'before') {
      merged = applyField(merged, overlook, field);
      continue;
    }
    conflicts.push({ field, imageTrailRevision, overlookRevision });
  }
  merged = withMergedRevisions(merged, imageTrail, overlook);
  const category = conflicts.length > 0 ? 'conflict' : merged.deletedAt === null ? 'eligible' : 'delete-review';
  return { category, merged, conflicts };
}

export function resolveSyncConflicts(
  analysis: SyncAnalysis,
  imageTrail: InteropRecord,
  overlook: InteropRecord,
  decisions: Readonly<Partial<Record<SyncField, InteropConflictAction>>>,
): SyncApplyOutcome {
  let primary = analysis.merged;
  let secondary = analysis.merged;
  let keepBoth = false;
  for (const conflict of analysis.conflicts) {
    const decision = decisions[conflict.field];
    if (decision === undefined) throw new Error(`Sync conflict ${conflict.field} requires an explicit decision.`);
    if (decision === 'keep-both') {
      keepBoth = true;
      primary = applyField(primary, imageTrail, conflict.field);
      secondary = applyField(secondary, overlook, conflict.field);
      continue;
    }
    const product = decision === 'keep-image-trail' ? 'image-trail' : 'overlook';
    const source = recordForProduct(product, imageTrail, overlook);
    primary = applyField(primary, source, conflict.field);
    secondary = applyField(secondary, source, conflict.field);
  }
  return { primary, secondary: keepBoth ? secondary : null };
}
