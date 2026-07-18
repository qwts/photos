import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const READY_MARKER = 'overlook-heic-smoke:ready:3024x4032';
const appPath = process.argv[2];
const fixturePath = process.argv[3];
if (process.platform !== 'darwin') throw new Error('macOS HEIC verification requires macOS');
if (appPath === undefined || fixturePath === undefined) {
  throw new Error('usage: node scripts/verify-macos-heic-preview.mjs /path/Overlook.app /path/fixture.heic');
}

const resolvedApp = resolve(appPath);
const resolvedFixture = resolve(fixturePath);
const packagedBinding = join(resolvedApp, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', '@overlook', 'touch-id', 'raw.cjs');
await access(packagedBinding);

// Production disables Electron's runAsNode fuse. Use the pinned build-time
// Electron runtime to load the exact native module copied into the artifact;
// this verifies packaging, ABI compatibility, ImageIO decode, and JPEG output.
const result = execFileSync(
  resolve('node_modules/.bin/electron'),
  [resolve('scripts/run-packaged-heic-smoke.cjs'), packagedBinding, resolvedFixture],
  {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 30_000,
  },
);
if (!result.includes(READY_MARKER)) throw new Error(`packaged HEIC decode returned no readiness marker\n${result}`);
console.log(`[overlook] packaged HEIC preview verified: ${resolvedApp}`);
