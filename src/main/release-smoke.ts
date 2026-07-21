import { writeSync } from 'node:fs';

import { ICLOUD_NATIVE_SMOKE_ARGUMENT, runICloudNativeSmokeIfRequested } from './backup/icloud-drive/native-smoke.js';

export const RELEASE_SMOKE_ARGUMENT = '--overlook-release-smoke';
export const RELEASE_SMOKE_READY_MARKER = 'overlook-release-smoke:ready';

interface ReleaseSmokeApp {
  readonly isPackaged: boolean;
  exit(code: number): void;
}

export async function exitForReleaseSmokeIfRequested(
  app: ReleaseSmokeApp,
  argv: readonly string[] = process.argv,
  write: (value: string) => unknown = (value) => writeSync(process.stdout.fd, value),
): Promise<boolean> {
  if (argv.includes(ICLOUD_NATIVE_SMOKE_ARGUMENT)) {
    return runICloudNativeSmokeIfRequested(app, { argv, write });
  }
  if (!argv.includes(RELEASE_SMOKE_ARGUMENT)) return false;
  write(`${RELEASE_SMOKE_READY_MARKER}\n`);
  app.exit(0);
  return true;
}
