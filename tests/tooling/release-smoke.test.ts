import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { RELEASE_SMOKE_ARGUMENT, RELEASE_SMOKE_READY_MARKER, exitForReleaseSmokeIfRequested } from '../../src/main/release-smoke.js';

describe('packaged release launch smoke (#357)', () => {
  test('does not intercept normal launches', async () => {
    const exits: number[] = [];
    assert.equal(await exitForReleaseSmokeIfRequested({ isPackaged: true, exit: (code) => exits.push(code) }, ['Overlook']), false);
    assert.deepEqual(exits, []);
  });

  test('emits a stable readiness boundary for the verifier', async () => {
    let marker = '';
    const exits: number[] = [];
    assert.equal(
      await exitForReleaseSmokeIfRequested(
        { isPackaged: true, exit: (code) => exits.push(code) },
        ['Overlook', RELEASE_SMOKE_ARGUMENT],
        (value) => {
          marker = value;
        },
      ),
      true,
    );
    assert.equal(marker, `${RELEASE_SMOKE_READY_MARKER}\n`);
    assert.deepEqual(exits, [0]);
  });

  test('the production writer flushes the marker synchronously before exit', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/release-smoke.ts'), 'utf8');
    assert.match(source, /writeSync\(process\.stdout\.fd/u);
  });
});
