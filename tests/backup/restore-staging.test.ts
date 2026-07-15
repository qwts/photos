import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { activateStagedLibrary, restorePaths } from '../../src/main/backup/restore-staging.js';

test('activation failure rolls the previous library back into place (#288)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'overlook-activation-'));
  const paths = restorePaths(join(root, 'library'));
  writeFileSync(join(root, 'placeholder'), 'parent');
  await mkdir(paths.targetDir);
  await mkdir(paths.stagingDir);
  writeFileSync(join(paths.targetDir, 'old'), 'old library');
  writeFileSync(join(paths.stagingDir, 'new'), 'new library');
  let renames = 0;

  await assert.rejects(
    activateStagedLibrary(paths, {
      rm,
      rename: async (from, to) => {
        renames += 1;
        if (renames === 2) throw new Error('injected activation failure');
        await rename(from, to);
      },
    }),
    /injected activation failure/u,
  );

  assert.equal(await readFile(join(paths.targetDir, 'old'), 'utf8'), 'old library');
  assert.equal(existsSync(paths.previousDir), false);
  assert.equal(await readFile(join(paths.stagingDir, 'new'), 'utf8'), 'new library');
});
