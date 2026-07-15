import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { MockProvider } from '../../src/main/backup/mock-provider.js';
import { ulid } from '../../src/main/import/ulid.js';
import { exerciseDisasterRecoveryContract } from './disaster-recovery-contract.js';
import { exerciseRestoreProviderContract } from './restore-provider-contract.js';

test('mock provider satisfies reusable restore and complete disaster-recovery contracts (#291)', async () => {
  const libraryId = ulid();
  const browser = new MockProvider({ rootDir: mkdtempSync(join(tmpdir(), 'overlook-dr-contract-')), libraryId });
  await exerciseRestoreProviderContract(browser, libraryId);
  await exerciseDisasterRecoveryContract(browser, libraryId);
});
