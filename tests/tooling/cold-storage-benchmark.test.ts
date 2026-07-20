import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

interface Trial {
  readonly corpus: string;
  readonly representation: string;
  readonly method: string;
  readonly inputBytes: number;
  readonly archiveBytes: number;
  readonly savingsPercent: number;
  readonly packMs: number;
  readonly unpackMs: number;
  readonly peakRssBytes: number | null;
}

interface BenchmarkArtifact {
  readonly schemaVersion: number;
  readonly trials: readonly Trial[];
}

function artifact(): BenchmarkArtifact {
  return JSON.parse(readFileSync(join(process.cwd(), 'docs/benchmarks/cold-storage-2026-07-20.json'), 'utf8')) as BenchmarkArtifact;
}

describe('cold-storage archive spike (#507)', () => {
  test('the recorded matrix covers every corpus, representation, and method', () => {
    const result = artifact();
    assert.equal(result.schemaVersion, 1);
    const expected = new Set<string>();
    for (const corpus of ['jpeg', 'heic', 'raw', 'sidecar', 'mixed']) {
      for (const representation of ['plaintext', 'ovlk-envelope']) {
        for (const method of ['zip-deflate-9', 'tar-zstd-3', 'format-aware-zip']) {
          expected.add(`${corpus}/${representation}/${method}`);
        }
      }
    }

    const actual = new Set(result.trials.map((trial) => `${trial.corpus}/${trial.representation}/${trial.method}`));
    assert.deepEqual(actual, expected);
    for (const trial of result.trials) {
      assert.ok(trial.inputBytes > 0);
      assert.ok(trial.archiveBytes > 0);
      assert.ok(trial.packMs > 0);
      assert.ok(trial.unpackMs > 0);
      assert.ok(trial.peakRssBytes === null || trial.peakRssBytes > 0);
    }
  });

  test('the no-go verdict is supported by every measured encrypted corpus', () => {
    const encrypted = artifact().trials.filter((trial) => trial.representation === 'ovlk-envelope');
    assert.equal(encrypted.length, 15);
    assert.ok(encrypted.every((trial) => trial.archiveBytes > trial.inputBytes));
    assert.ok(encrypted.every((trial) => trial.savingsPercent < 0));
  });
});
