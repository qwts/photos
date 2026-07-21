import type { PhotoRecord } from './types.js';

export type DuplicateClassification = Pick<PhotoRecord, 'isOriginal'>;

/**
 * Shared eligibility seam for duplicate consumers (#482). Detection remains
 * outside this module: callers first discover a candidate pair, then apply
 * this policy before storing, grouping, or presenting it.
 */
export function duplicatePairEligible(left: DuplicateClassification, right: DuplicateClassification): boolean {
  return left.isOriginal === right.isOriginal;
}
