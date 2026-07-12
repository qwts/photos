// Copy rules (design README): counts render with en-US thousands separators
// wherever machine data meets the UI (status bar, sidebar, selection pill).
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
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
