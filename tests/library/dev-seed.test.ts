import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runDevSeeds, type DevSeedOptions } from '../../src/main/library/dev-seed.js';

// Dev-seed harness policy (#72/#74): env-gated, no-op without content
// access, and it never touches the library when no seed is requested.

function options(env: Record<string, string>, overrides: Partial<DevSeedOptions> = {}): { opts: DevSeedOptions; opened: number[] } {
  const opened: number[] = [];
  const opts: DevSeedOptions = {
    contentAvailable: true,
    harnessEnv: (name) => env[name],
    open: () => {
      opened.push(1);
      return undefined; // bootstrap failed — seeds must tolerate it
    },
    ...overrides,
  };
  return { opts, opened };
}

describe('dev seeds', () => {
  test('no env, no library touch', async () => {
    const { opts, opened } = options({});
    await runDevSeeds(opts);
    assert.equal(opened.length, 0);
  });

  test('locked content skips seeding entirely even when requested', async () => {
    const { opts, opened } = options({ OVERLOOK_SEED: '3' }, { contentAvailable: false });
    await runDevSeeds(opts);
    assert.equal(opened.length, 0);
  });

  test('a requested seed opens the library and tolerates a failed bootstrap', async () => {
    const { opts, opened } = options({ OVERLOOK_SEED: '3', OVERLOOK_SEED_SYNTHETIC: '5' });
    await runDevSeeds(opts); // open() returns undefined both times — no throw
    assert.equal(opened.length, 2);
  });

  test('garbage counts are ignored', async () => {
    const { opts, opened } = options({ OVERLOOK_SEED: 'lots', OVERLOOK_SEED_SYNTHETIC: '-1' });
    await runDevSeeds(opts);
    assert.equal(opened.length, 0);
  });
});
