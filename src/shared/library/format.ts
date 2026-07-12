// Copy rules (design README): counts render with en-US thousands separators
// wherever machine data meets the UI (status bar, sidebar, selection pill).
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}
