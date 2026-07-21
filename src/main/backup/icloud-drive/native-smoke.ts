import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createNativeICloudDriveBridge, type ICloudDriveNativeBridge } from './native-bridge.js';

export const ICLOUD_NATIVE_SMOKE_ARGUMENT = '--overlook-icloud-native-smoke';
export const ICLOUD_NATIVE_SMOKE_READY_MARKER = 'overlook-icloud-native-smoke:ready';

interface SmokeApp {
  readonly isPackaged: boolean;
  exit(code: number): void;
}

interface NativeSmokeOptions {
  readonly argv?: readonly string[];
  readonly bridge?: ICloudDriveNativeBridge;
  readonly platform?: NodeJS.Platform;
  readonly write?: (value: string) => unknown;
}

export async function runICloudNativeSmokeIfRequested(app: SmokeApp, options: NativeSmokeOptions = {}): Promise<boolean> {
  const argv = options.argv ?? process.argv;
  if (!argv.includes(ICLOUD_NATIVE_SMOKE_ARGUMENT)) return false;

  const write = options.write ?? ((value: string) => process.stdout.write(value));
  const bridge =
    options.bridge ?? createNativeICloudDriveBridge({ platform: options.platform ?? process.platform, packaged: app.isPackaged });
  const local = await mkdtemp(join(tmpdir(), 'overlook-icloud-native-smoke-'));
  const remoteRoot = `Overlook/.native-smoke/${randomUUID()}`;
  const remotePath = `${remoteRoot}/object.ovrb`;
  const source = join(local, 'source.ovrb');
  const destination = join(local, 'destination.ovrb');
  const expected = Buffer.from('overlook-icloud-native-smoke-v1');
  let accountToken: string | null = null;
  let uploaded = false;

  try {
    const status = await bridge.status();
    if (!status.available || status.accountToken === null) {
      throw new Error(`iCloud unavailable: ${status.reason ?? 'unknown'}`);
    }
    accountToken = status.accountToken;
    await writeFile(source, expected, { flag: 'wx' });
    await bridge.replaceFile(remotePath, source, accountToken);
    uploaded = true;
    const page = await bridge.list(remoteRoot, null, 100, accountToken);
    if (page.accountToken !== accountToken || !page.entries.some((entry) => entry.path === remotePath)) {
      throw new Error('coordinated listing did not return the scratch object');
    }
    await bridge.materializeFile(remotePath, destination, accountToken);
    if (!(await readFile(destination)).equals(expected)) throw new Error('materialized scratch bytes differ');
    await bridge.delete(remotePath, accountToken);
    uploaded = false;
    write(`${ICLOUD_NATIVE_SMOKE_READY_MARKER}\n`);
    app.exit(0);
  } catch (error) {
    write(`overlook-icloud-native-smoke:error:${error instanceof Error ? error.message : 'unknown'}\n`);
    app.exit(1);
  } finally {
    if (uploaded && accountToken !== null) {
      await bridge.delete(remotePath, accountToken).catch(() => undefined);
    }
    await rm(local, { recursive: true, force: true });
  }
  return true;
}
