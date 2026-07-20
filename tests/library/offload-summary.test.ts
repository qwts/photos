import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatOffloadResultTitle } from '../../src/renderer/src/offload/offload-summary.js';
import { formatBytes, formatCount } from '../../src/shared/i18n/formats.js';

const formats = {
  formatBytes: (bytes: number) => formatBytes('en', bytes),
  formatCount: (value: number) => formatCount('en', value),
};

test('manual offload completion reports exact mixed counts and reasons (#281)', () => {
  assert.equal(
    formatOffloadResultTitle(
      {
        offloaded: 1,
        skipped: 2,
        failed: 1,
        freedBytes: 8_400_000,
        results: [
          { photoId: 'ready', outcome: 'offloaded', reason: null },
          { photoId: 'dirty', outcome: 'skipped', reason: 'dirty' },
          { photoId: 'offline', outcome: 'skipped', reason: 'provider-offline' },
          { photoId: 'disk', outcome: 'failed', reason: 'delete-failed' },
        ],
      },
      formats,
    ),
    'Offloaded 1 · 2 skipped · 1 failed · Freed 8.4 MB — 1 changed since verified backup, 1 cloud provider offline, 1 local removal failed',
  );
});
