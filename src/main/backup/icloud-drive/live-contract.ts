import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { exerciseDisasterRecoveryContract } from '../disaster-recovery-contract.js';
import { exerciseObjectProviderContract } from '../object-provider-contract.js';
import { exerciseRestoreProviderContract } from '../restore-provider-contract.js';
import { ulid } from '../../import/ulid.js';
import { ICloudDriveProvider } from './icloud-drive-provider.js';
import { createNativeICloudDriveBridge, type ICloudDriveNativeBridge } from './native-bridge.js';

export const ICLOUD_LIVE_CONTRACT_ARGUMENT = '--overlook-icloud-live-contract';
export const ICLOUD_LIVE_CONTRACT_MARKER = 'overlook-icloud-live-contract:evidence:';

interface LiveContractApp {
  readonly isPackaged: boolean;
  exit(code: number): void;
}

interface LiveContractOptions {
  readonly argv?: readonly string[];
  readonly bridge?: ICloudDriveNativeBridge;
  readonly platform?: NodeJS.Platform;
  readonly write?: (value: string) => unknown;
}

interface LiveEvidence {
  readonly schema: 1;
  readonly result: 'pass' | 'fail';
  readonly scratchLibraries: readonly string[];
  readonly checks: readonly string[];
  readonly cleanup: boolean;
  readonly error?: string;
}

async function exerciseReplacementAndPagination(provider: ICloudDriveProvider, libraryId: string): Promise<void> {
  const scoped = provider.forLibrary(libraryId);
  const paths = ['blobs/live/a', 'blobs/live/b', 'blobs/live/c'] as const;
  const replacement = Buffer.from('OVLK-icloud-live-replacement-v2');
  try {
    await scoped.put(paths[0], Readable.from([Buffer.from('OVLK-icloud-live-replacement-v1')]));
    await scoped.put(paths[0], Readable.from([replacement]));
    await scoped.put(paths[1], Readable.from([Buffer.from('OVLK-icloud-live-page-b')]));
    await scoped.put(paths[2], Readable.from([Buffer.from('OVLK-icloud-live-page-c')]));
    assert.deepEqual(
      (await scoped.list('blobs/live')).map(({ path }) => path),
      paths,
      'page-size-one listing returns every sorted scratch object',
    );
    assert.deepEqual(await scoped.verify(paths[0]), {
      bytes: replacement.length,
      sha256: createHash('sha256').update(replacement).digest('hex'),
    });
  } finally {
    const cleanup = await Promise.allSettled(paths.map((path) => scoped.delete(path)));
    assert.equal(cleanup.filter(({ status }) => status === 'rejected').length, 0);
  }
  assert.deepEqual(await scoped.list('blobs/live'), []);
}

export async function runICloudLiveContractIfRequested(app: LiveContractApp, options: LiveContractOptions = {}): Promise<boolean> {
  const argv = options.argv ?? process.argv;
  if (!argv.includes(ICLOUD_LIVE_CONTRACT_ARGUMENT)) return false;
  const write = options.write ?? ((value: string) => process.stdout.write(value));
  const scratchLibraries = [ulid(), ulid(), ulid(), ulid()] as const;
  const checks: string[] = [];
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'overlook-icloud-live-contract-'));
  let cleanup = false;
  const emit = (evidence: LiveEvidence): void => {
    write(`${ICLOUD_LIVE_CONTRACT_MARKER}${JSON.stringify(evidence)}\n`);
  };
  let exitCode = 1;
  try {
    if (!app.isPackaged) throw new Error('signed packaged app required');
    const bridge = options.bridge ?? createNativeICloudDriveBridge({ platform: options.platform ?? process.platform, packaged: true });
    const status = await bridge.status();
    if (!status.available || status.accountToken === null) throw new Error(`iCloud unavailable: ${status.reason ?? 'unknown'}`);
    const provider = new ICloudDriveProvider({
      bridge,
      libraryId: scratchLibraries[0],
      accountToken: status.accountToken,
      requireExplicitAuthority: true,
      temporaryRoot,
      pageSize: 1,
    });
    await exerciseObjectProviderContract(provider, scratchLibraries[0]);
    checks.push('object');
    await exerciseReplacementAndPagination(provider, scratchLibraries[1]);
    checks.push('replacement-pagination-materialization-sha256');
    await exerciseRestoreProviderContract(provider, scratchLibraries[2]);
    checks.push('restore-provider');
    assert.deepEqual(await exerciseDisasterRecoveryContract(provider, scratchLibraries[3]), { generation: 1, photos: 2 });
    checks.push('fresh-profile-disaster-recovery');
    const scratchContents = await Promise.all(scratchLibraries.map((libraryId) => provider.forLibrary(libraryId).list('.')));
    cleanup = scratchContents.every((entries) => entries.length === 0);
    assert.equal(cleanup, true, 'scratch recovery homes are fully cleaned');
    emit({ schema: 1, result: 'pass', scratchLibraries, checks, cleanup });
    exitCode = 0;
  } catch (error) {
    emit({
      schema: 1,
      result: 'fail',
      scratchLibraries,
      checks,
      cleanup,
      error: error instanceof Error ? error.message : 'unknown',
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  app.exit(exitCode);
  return true;
}
