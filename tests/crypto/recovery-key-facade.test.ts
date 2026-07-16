import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createRecoveryKeyFacade } from '../../src/main/crypto/recovery-key-facade.js';

describe('recovery-key facade app-lock custody (#311)', () => {
  test('rejects legacy import before file or key custody access while app lock is configured', async () => {
    const facade = createRecoveryKeyFacade({
      keyStore: () => {
        throw new Error('key store must not be accessed');
      },
      safeStorage: () => {
        throw new Error('safe storage must not be accessed');
      },
      dataDir: () => {
        throw new Error('data directory must not be accessed');
      },
      pickExportDestination: () => Promise.resolve(null),
      pickImportSource: () => Promise.resolve(null),
      allowImport: () => false,
    });

    await assert.rejects(
      facade.importKey('/path-that-must-not-be-read', 'password'),
      /recovery-key import is unavailable while app lock is configured/,
    );
  });
});
