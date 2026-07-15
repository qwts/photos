import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { activationOperationsForHarness } from '../../src/main/backup/restore-fault.js';
import { activateStagedLibrary, recoverInterruptedActivation, restorePaths } from '../../src/main/backup/restore-staging.js';

test('startup restores the previous library before fresh-profile classification (#290 review)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'overlook-activation-recovery-'));
  const paths = restorePaths(join(root, 'library'));
  await mkdir(paths.previousDir);
  writeFileSync(join(paths.previousDir, 'library.db'), 'previous library');

  await recoverInterruptedActivation(paths);

  assert.equal(await readFile(join(paths.targetDir, 'library.db'), 'utf8'), 'previous library');
  assert.equal(existsSync(paths.previousDir), false);
});

test('startup removes a stale previous directory after successful activation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'overlook-activation-cleanup-'));
  const paths = restorePaths(join(root, 'library'));
  await mkdir(paths.targetDir);
  await mkdir(paths.previousDir);
  writeFileSync(join(paths.targetDir, 'library.db'), 'active library');

  await recoverInterruptedActivation(paths);

  assert.equal(await readFile(join(paths.targetDir, 'library.db'), 'utf8'), 'active library');
  assert.equal(existsSync(paths.previousDir), false);
});

test('activation failure rolls the previous library back into place (#288)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'overlook-activation-'));
  const paths = restorePaths(join(root, 'library'));
  writeFileSync(join(root, 'placeholder'), 'parent');
  await mkdir(paths.targetDir);
  await mkdir(paths.stagingDir);
  writeFileSync(join(paths.targetDir, 'old'), 'old library');
  writeFileSync(join(paths.stagingDir, 'new'), 'new library');
  assert.equal(activationOperationsForHarness(undefined), undefined);
  const operations = activationOperationsForHarness('activation');
  assert.ok(operations);

  await assert.rejects(activateStagedLibrary(paths, operations), /injected activation failure/u);

  assert.equal(await readFile(join(paths.targetDir, 'old'), 'utf8'), 'old library');
  assert.equal(existsSync(paths.previousDir), false);
  assert.equal(await readFile(join(paths.stagingDir, 'new'), 'utf8'), 'new library');
});
