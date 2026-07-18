import { existsSync, readFileSync, rmSync, unlinkSync } from 'node:fs';

import { tmpRegistryEnvVar } from './support/tmp-dir.js';

// Sweeps every directory mkE2eTmpDir (support/tmp-dir.ts) registered during
// this run. Playwright's own failure artifacts (screenshot/trace/video, see
// the `use` block in playwright.config.ts) live under test-results/ and never
// reference the Electron userData/SD-card/export dirs cleaned up here, so
// removing them is safe regardless of whether the test that created them
// passed or failed.
export default function globalTeardown(): void {
  const registryPath = process.env[tmpRegistryEnvVar];
  if (!registryPath || !existsSync(registryPath)) return;

  const dirs = readFileSync(registryPath, 'utf8').split('\n').filter(Boolean);
  for (const dir of dirs) {
    try {
      // force tolerates a dir a test already removed itself; maxRetries/
      // retryDelay tolerate Electron still releasing its lock on the userData
      // dir in the instant right after app.close() resolves.
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // best-effort: a leftover dir here is a disk-space nuisance, not a test failure
    }
  }
  unlinkSync(registryPath);
}
