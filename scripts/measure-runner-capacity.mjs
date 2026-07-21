#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, freemem, loadavg, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const SAMPLE_MS = 1_000;

export function parsePressure(text) {
  const some = text.match(/^some\s+(.+)$/mu)?.[1] ?? '';
  return Object.fromEntries([...some.matchAll(/(avg10|avg60|avg300|total)=([0-9.]+)/gu)].map((match) => [match[1], Number(match[2])]));
}

function pressure(kind) {
  try {
    return parsePressure(readFileSync(`/proc/pressure/${kind}`, 'utf8'));
  } catch {
    return null;
  }
}

function sample() {
  const loads = loadavg();
  return {
    atMs: Date.now(),
    load1: loads[0],
    load5: loads[1],
    load15: loads[2],
    freeMemoryMb: Math.round(freemem() / 1024 / 1024),
    cpuPressure: pressure('cpu'),
    ioPressure: pressure('io'),
  };
}

export function summarize(samples, cpuCount) {
  const peak = (field) => Math.max(0, ...samples.map((entry) => entry[field]));
  const pressurePeak = (field) => Math.max(0, ...samples.map((entry) => entry[field]?.avg10 ?? 0));
  return {
    sampleCount: samples.length,
    peakLoad1: peak('load1'),
    peakNormalizedLoad1: peak('load1') / Math.max(1, cpuCount),
    minimumFreeMemoryMb: Math.min(...samples.map((entry) => entry.freeMemoryMb)),
    peakCpuPressureAvg10: pressurePeak('cpuPressure'),
    peakIoPressureAvg10: pressurePeak('ioPressure'),
  };
}

function main() {
  const separator = process.argv.indexOf('--');
  if (separator < 0 || separator === process.argv.length - 1) {
    process.stderr.write('usage: measure-runner-capacity.mjs -- <command> [args...]\n');
    process.exit(2);
  }
  const command = process.argv.slice(separator + 1);
  const output = resolve(process.env.OVERLOOK_CAPACITY_OUTPUT ?? 'test-results/runner-capacity.json');
  const startedAt = Date.now();
  const samples = [sample()];
  const timer = setInterval(() => samples.push(sample()), SAMPLE_MS);
  const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env: process.env });

  child.on('error', (error) => {
    clearInterval(timer);
    process.stderr.write(`capacity measurement failed to start command: ${error.message}\n`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    clearInterval(timer);
    samples.push(sample());
    const cpuCount = availableParallelism();
    const record = {
      schemaVersion: 1,
      label: process.env.OVERLOOK_CAPACITY_LABEL ?? 'default',
      command,
      workers: process.env.OVERLOOK_E2E_WORKERS ?? 'default',
      retries: process.env.OVERLOOK_E2E_RETRIES ?? 'default',
      platform: process.platform,
      cpuCount,
      logicalCpuCount: cpus().length,
      totalMemoryMb: Math.round(totalmem() / 1024 / 1024),
      durationMs: Date.now() - startedAt,
      exitCode: code,
      signal,
      summary: summarize(samples, cpuCount),
      samples,
    };
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
    process.stdout.write(`[capacity] ${JSON.stringify({ output, ...record.summary, durationMs: record.durationMs })}\n`);
    process.exit(code ?? (signal === null ? 0 : 1));
  });
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
