// Debounced auto-backup scheduling (#267): dirtying edits fire in bursts
// (multi-select favorite, album drops) — one trailing run covers them all.

export const AUTO_BACKUP_EDIT_DEBOUNCE_MS = 1500;

export interface AutoBackupScheduler {
  (): void;
  cancel(): void;
}

export function createAutoBackupScheduler(fire: () => void, debounceMs: number = AUTO_BACKUP_EDIT_DEBOUNCE_MS): AutoBackupScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule: AutoBackupScheduler = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fire();
    }, debounceMs);
  };
  schedule.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return schedule;
}
