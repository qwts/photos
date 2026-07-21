import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

interface CapacityModule {
  readonly parsePressure: (text: string) => Record<string, number>;
  readonly summarize: (
    samples: readonly {
      readonly load1: number;
      readonly freeMemoryMb: number;
      readonly cpuPressure: { readonly avg10?: number } | null;
      readonly ioPressure: { readonly avg10?: number } | null;
    }[],
    cpuCount: number,
  ) => Record<string, number>;
}

const { parsePressure, summarize } = (await import(
  pathToFileURL(join(process.cwd(), 'scripts/measure-runner-capacity.mjs')).href
)) as CapacityModule;

describe('runner capacity evidence', () => {
  it('parses Linux pressure stall information without depending on field order', () => {
    assert.deepEqual(parsePressure('some avg60=2.00 avg10=1.25 avg300=3.00 total=42\nfull avg10=0.1 total=1\n'), {
      avg60: 2,
      avg10: 1.25,
      avg300: 3,
      total: 42,
    });
  });

  it('summarizes normalized load, memory, and CPU/I/O pressure peaks', () => {
    const samples = [
      { load1: 2, freeMemoryMb: 8000, cpuPressure: { avg10: 1 }, ioPressure: { avg10: 0.5 } },
      { load1: 6, freeMemoryMb: 7000, cpuPressure: { avg10: 4 }, ioPressure: { avg10: 3 } },
    ];
    assert.deepEqual(summarize(samples, 4), {
      sampleCount: 2,
      peakLoad1: 6,
      peakNormalizedLoad1: 1.5,
      minimumFreeMemoryMb: 7000,
      peakCpuPressureAvg10: 4,
      peakIoPressureAvg10: 3,
    });
  });
});
