import { writeFileSync } from 'node:fs';

import type { QueuedDiagnostic } from './diagnostics-queue.js';

/** Writes only the exact allowlisted payloads already shown by inspection.
 * The destination comes from a main-process save dialog, never the renderer. */
export function writeDiagnosticsExport(destination: string, reports: readonly QueuedDiagnostic[]): void {
  const jsonl = reports.length === 0 ? '' : `${reports.map((report) => report.payload).join('\n')}\n`;
  writeFileSync(destination, jsonl, { encoding: 'utf8' });
}
