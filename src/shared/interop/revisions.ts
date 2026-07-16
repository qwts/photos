import type { InteropProduct, InteropRevisionVector } from './contract.js';

export type InteropRevisionRelation = 'equal' | 'before' | 'after' | 'concurrent';

export function compareInteropRevisions(left: InteropRevisionVector, right: InteropRevisionVector): InteropRevisionRelation {
  const leftBeforeOrEqual = left.imageTrail <= right.imageTrail && left.overlook <= right.overlook;
  const rightBeforeOrEqual = right.imageTrail <= left.imageTrail && right.overlook <= left.overlook;
  if (leftBeforeOrEqual && rightBeforeOrEqual) return 'equal';
  if (leftBeforeOrEqual) return 'before';
  if (rightBeforeOrEqual) return 'after';
  return 'concurrent';
}

export function incrementInteropRevision(revision: InteropRevisionVector, product: InteropProduct): InteropRevisionVector {
  return product === 'image-trail'
    ? { imageTrail: revision.imageTrail + 1, overlook: revision.overlook }
    : { imageTrail: revision.imageTrail, overlook: revision.overlook + 1 };
}

export function mergeInteropRevisions(left: InteropRevisionVector, right: InteropRevisionVector): InteropRevisionVector {
  return {
    imageTrail: Math.max(left.imageTrail, right.imageTrail),
    overlook: Math.max(left.overlook, right.overlook),
  };
}
