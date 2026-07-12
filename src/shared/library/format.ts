// Copy rules (design README): counts render with en-US thousands separators
// wherever machine data meets the UI (status bar, sidebar, selection pill).
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * Mono uppercase relative times for the status bar (#81): "JUST NOW",
 * "5M AGO", "2H AGO", "3D AGO". `now` is injected for testability.
 */
export function formatRelativeTime(iso: string, now: number): string {
  const elapsedMs = now - Date.parse(iso);
  if (Number.isNaN(elapsedMs) || elapsedMs < 0) {
    return 'JUST NOW';
  }
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) {
    return 'JUST NOW';
  }
  if (minutes < 60) {
    return `${String(minutes)}M AGO`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}H AGO`;
  }
  return `${String(Math.floor(hours / 24))}D AGO`;
}

/** Uppercase storage sizes for mono chrome lines: "1.2 TB", "380 GB". */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const rounded = value >= 100 || Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1);
  return `${rounded} ${units[unit] ?? 'B'}`;
}
