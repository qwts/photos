export const TRASH_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function trashDaysRemaining(deletedAt: string, now = Date.now()): number {
  const elapsed = Math.max(0, now - Date.parse(deletedAt));
  return Math.max(0, Math.ceil(TRASH_RETENTION_DAYS - elapsed / DAY_MS));
}

export function trashRetentionLabel(deletedAt: string, now = Date.now()): string {
  const days = trashDaysRemaining(deletedAt, now);
  if (days === 0) return 'Deletes permanently today';
  return `Deletes permanently in ${days} ${days === 1 ? 'day' : 'days'}`;
}
