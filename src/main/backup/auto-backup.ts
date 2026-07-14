// Debounced auto-backup scheduling (#267): dirtying edits fire in bursts
// (multi-select favorite, album drops) — one trailing run covers them all.

export const AUTO_BACKUP_EDIT_DEBOUNCE_MS = 1500;

export function createAutoBackupScheduler(fire: () => void, debounceMs: number = AUTO_BACKUP_EDIT_DEBOUNCE_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fire, debounceMs);
  };
}
