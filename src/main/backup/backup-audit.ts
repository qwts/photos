import { appendFile } from 'node:fs/promises';

/** Best-effort append-only evidence trail; backup work must not fail because
 * the diagnostic log could not be written. */
export function createBackupAuditLogger(path: string): (line: string) => void {
  return (line) => {
    void appendFile(path, `${new Date().toISOString()} ${line}\n`).catch(() => undefined);
  };
}
