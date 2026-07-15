import { rename, rm } from 'node:fs/promises';

import type { ActivationOperations } from './restore-staging.js';

/** Unpackaged-harness fault used to prove the activation rollback through
 * the complete Electron/IPC restore path. The caller owns the env gate. */
export function activationOperationsForHarness(fault: string | undefined): ActivationOperations | undefined {
  if (fault !== 'activation') return undefined;
  let renames = 0;
  return {
    rm,
    rename: async (from, to) => {
      renames += 1;
      if (renames === 2) throw new Error('injected activation failure');
      await rename(from, to);
    },
  };
}
