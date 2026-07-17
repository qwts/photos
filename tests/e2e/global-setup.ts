import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Build the app exactly once, before any worker starts (image-trail's pattern:
// `npm run build` begins by removing dist/, so concurrent per-worker builds would
// clobber each other's output). The smoke lane doesn't consume dist/ yet, but the
// E2E lane failing on a broken build is part of the gate's job.
export default function globalSetup(): void {
  process.env['OVERLOOK_E2E'] = '1';
  process.env['OVERLOOK_E2E_WINDOW'] = process.env['OVERLOOK_E2E_VISIBLE'] === '1' ? 'visible' : 'hidden';
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit', env: process.env });
}
