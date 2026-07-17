import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

describe('release workflow assets', () => {
  test('uploads files recursively instead of passing artifact directories to gh', () => {
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf8');

    assert.match(workflow, /find dist -type f -print0/u);
    assert.match(workflow, /gh release upload "\$TAG" "\$\{assets\[@\]\}"/u);
    assert.match(workflow, /gh release create "\$TAG" "\$\{assets\[@\]\}"/u);
    assert.doesNotMatch(workflow, /gh release (?:create|upload)[^\n]*dist\/\*/u);
  });
});
