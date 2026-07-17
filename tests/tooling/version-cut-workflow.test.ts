import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

describe('version-cut workflow', () => {
  test('dispatches version-branch checks only after Changesets creates the PR', () => {
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/version-cut.yml'), 'utf8');

    assert.match(workflow, /if: steps\.changesets\.outputs\.pullRequestNumber != ''/u);
    assert.doesNotMatch(workflow, /if: steps\.changesets\.outputs\.hasChangesets == 'true'/u);
  });
});
