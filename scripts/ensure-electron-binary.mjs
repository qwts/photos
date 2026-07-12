// Electron ships without a postinstall script (npm script-approval era); the
// prebuilt binary must be fetched explicitly via its install.js. Run it from
// our own postinstall — it exits immediately when the binary is present.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let installScript;
try {
  installScript = require.resolve('electron/install.js');
} catch {
  // electron absent (e.g. `npm ci --omit=dev`) — nothing to fetch.
  process.exit(0);
}

const result = spawnSync(process.execPath, [installScript], { stdio: 'inherit' });
process.exit(result.status ?? 1);
