import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createAutoBackupScheduler } from '../../src/main/backup/auto-backup.js';

// #267: bursts of dirtying edits coalesce into ONE trailing run.

describe('auto-backup scheduler (#267)', () => {
  test('trailing debounce: a burst fires once, after the window', async () => {
    let fired = 0;
    const schedule = createAutoBackupScheduler(() => {
      fired += 1;
    }, 20);
    schedule();
    schedule();
    schedule();
    assert.equal(fired, 0, 'nothing fires inside the window');
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(fired, 1, 'the burst coalesced into one run');

    schedule();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(fired, 2, 'a later edit schedules again');
  });

  test('cancel drops pending work without disabling future scheduling', async () => {
    let fired = 0;
    const schedule = createAutoBackupScheduler(() => {
      fired += 1;
    }, 20);
    schedule();
    schedule.cancel();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(fired, 0);

    schedule();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(fired, 1);
  });
});
