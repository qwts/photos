import { z } from 'zod';

export const TRASH_RETENTION_OPTIONS = ['off', '7', '30', '90'] as const;
export const trashRetentionSchema = z.enum(TRASH_RETENTION_OPTIONS);
export type TrashRetention = z.output<typeof trashRetentionSchema>;

export const DEFAULT_TRASH_RETENTION: TrashRetention = '30';

const DAY_MS = 24 * 60 * 60 * 1000;

export function trashRetentionDays(retention: TrashRetention): number | null {
  return retention === 'off' ? null : Number(retention);
}

export function trashDaysRemaining(deletedAt: string, retention: TrashRetention, now = Date.now()): number | null {
  const retentionDays = trashRetentionDays(retention);
  if (retentionDays === null) return null;
  const elapsed = Math.max(0, now - Date.parse(deletedAt));
  return Math.max(0, Math.ceil(retentionDays - elapsed / DAY_MS));
}

export function trashRetentionLabel(deletedAt: string, retention: TrashRetention, now = Date.now()): string {
  const days = trashDaysRemaining(deletedAt, retention, now);
  if (days === null) return 'Kept until deleted manually';
  if (days === 0) return 'Deletes permanently today';
  return `Deletes permanently in ${days} ${days === 1 ? 'day' : 'days'}`;
}
