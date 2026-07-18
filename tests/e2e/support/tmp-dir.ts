import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every E2E spec launches Electron (and, for import/export specs, SD-card and
// destination folders) against throwaway directories via mkdtempSync. None of
// that is Playwright-managed, so nothing removes it once the test ends — left
// alone, this accumulates one leftover directory per mkdtempSync call, per
// run, forever (a real machine hit 11,000+ leaked dirs / 20+ GB and ENOSPC).
// Routing every E2E temp dir through this helper instead of calling
// mkdtempSync directly appends its path to a run-scoped registry file
// (initialized by global-setup.ts) that global-teardown.ts sweeps once the
// whole run finishes.
export const tmpRegistryEnvVar = 'OVERLOOK_E2E_TMP_REGISTRY';

export function mkE2eTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const registryPath = process.env[tmpRegistryEnvVar];
  if (registryPath) {
    appendFileSync(registryPath, `${dir}\n`, 'utf8');
  }
  return dir;
}
