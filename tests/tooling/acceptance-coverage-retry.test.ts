import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

test('acceptance coverage retries transient GitHub API failures (#357)', () => {
  const source = readFileSync(join(process.cwd(), 'scripts/check-acceptance-coverage-diff.mjs'), 'utf8');
  assert.match(source, /const GH_ATTEMPTS = 3/u);
  assert.match(source, /attempt === GH_ATTEMPTS/u);
  assert.match(source, /await new Promise/u);
  assert.match(source, /await gh\(\['api'/u);
  assert.match(source, /git', \['diff', '--name-only'/u);
  assert.match(source, /signed pull-request event snapshot/u);
});
