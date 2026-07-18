#!/usr/bin/env node

// Repository-owned process-tree guard for test commands, ported from
// Image Trail (qwts/image-trail) after a memory-runaway incident there: a
// happy-dom `node:test` run grew ~2 GB/s, macOS attributed ~89 GB to the
// launcher coalition, and the machine was force-reset twice. Photos runs the
// same class of test (Electron-hosted `node:test`, happy-dom DOM suite,
// Playwright-driven Electron E2E), so this guard is adopted proactively here
// before this repo has its own incident.
//
// Wraps a command in its own process group and enforces, across the ENTIRE
// descendant tree (node workers, Electron, browsers, helpers):
//   - an aggregate RSS ceiling (V8's --max-old-space-size alone cannot catch
//     a runaway in a child process or a non-V8 helper),
//   - a per-process Node/V8 heap ceiling via NODE_OPTIONS,
//   - a wall-clock timeout,
//   - one-run-at-a-time per worktree (.guard/active.json lock),
//   - graceful-then-forced process-group termination,
//   - a small diagnostic record (.guard/last-run.json, .guard/history.jsonl).
//
// Usage: node scripts/run-guarded.mjs [--label name] [--rss-mb N] [--heap-mb N]
//        [--timeout-s N] [--] <command> [args...]
// Env (overrides flags; user/CI tuning knobs): OVERLOOK_GUARD_RSS_MB,
// OVERLOOK_GUARD_HEAP_MB, OVERLOOK_GUARD_TIMEOUT_S,
// OVERLOOK_GUARD_DISABLE=1 (passthrough), OVERLOOK_GUARDED (set for children
// so nested guarded scripts become passthrough instead of deadlocking on the
// worktree lock).

import { execFile, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULTS = { rssMb: 4096, heapMb: 2048, timeoutS: 900 };
const POLL_MS = 250;
const SIGKILL_AFTER_MS = 2000;
// Runaways can allocate faster than a SIGTERM shutdown completes; past this
// factor of the ceiling, skip straight to SIGKILL.
const HARD_KILL_FACTOR = 1.25;

function fail(message) {
  process.stderr.write(`[guard] ${message}\n`);
  process.exit(1);
}

export function parseArgs(argv) {
  const options = { label: 'command', rssMb: null, heapMb: null, timeoutS: null };
  let index = 0;
  const takeValue = (flag) => {
    index += 1;
    if (index >= argv.length) throw new Error(`missing value for ${flag}`);
    return argv[index];
  };
  for (; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      index += 1;
      break;
    }
    if (arg === '--label') options.label = takeValue(arg);
    else if (arg === '--rss-mb') options.rssMb = Number(takeValue(arg));
    else if (arg === '--heap-mb') options.heapMb = Number(takeValue(arg));
    else if (arg === '--timeout-s') options.timeoutS = Number(takeValue(arg));
    else if (arg.startsWith('--')) throw new Error(`unknown flag ${arg}`);
    else break;
  }
  return { options, command: argv.slice(index) };
}

export function resolveLimits(options, env) {
  const pick = (envName, flagValue, fallback) => {
    const raw = env[envName];
    const fromEnv = raw === undefined || raw === '' ? NaN : Number(raw);
    if (!Number.isNaN(fromEnv)) return fromEnv;
    if (flagValue !== null && !Number.isNaN(flagValue)) return flagValue;
    return fallback;
  };
  return {
    rssMb: pick('OVERLOOK_GUARD_RSS_MB', options.rssMb, DEFAULTS.rssMb),
    heapMb: pick('OVERLOOK_GUARD_HEAP_MB', options.heapMb, DEFAULTS.heapMb),
    timeoutS: pick('OVERLOOK_GUARD_TIMEOUT_S', options.timeoutS, DEFAULTS.timeoutS),
  };
}

// Aggregate RSS (KB) of the guarded tree: descendants of rootPid plus anything
// still in its process group (catches orphans that reparented to launchd/init).
export function collectTreeRssKb(psOutput, rootPid) {
  const rows = psOutput
    .split('\n')
    .map((line) => line.trim().split(/\s+/u).map(Number))
    .filter((fields) => fields.length === 4 && fields.every((value) => Number.isFinite(value)));
  const childrenByParent = new Map();
  for (const [pid, ppid] of rows) {
    if (!childrenByParent.has(ppid)) childrenByParent.set(ppid, []);
    childrenByParent.get(ppid).push(pid);
  }
  const members = new Set([rootPid]);
  const queue = [rootPid];
  while (queue.length > 0) {
    for (const child of childrenByParent.get(queue.pop()) ?? []) {
      if (!members.has(child)) {
        members.add(child);
        queue.push(child);
      }
    }
  }
  let totalKb = 0;
  let processCount = 0;
  for (const [pid, , pgid, rssKb] of rows) {
    if (members.has(pid) || pgid === rootPid) {
      totalKb += rssKb;
      processCount += 1;
    }
  }
  return { totalKb, processCount };
}

function passthrough(command) {
  const child = spawn(command[0], command.slice(1), { stdio: 'inherit' });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  child.on('error', (error) => fail(`failed to start command: ${error.message}`));
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function acquireLock(guardDir, label, command) {
  const lockPath = path.join(guardDir, 'active.json');
  const payload = JSON.stringify({ pid: process.pid, label, command: command.join(' '), startedAt: new Date().toISOString() }, null, 2);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lockPath, payload, { flag: 'wx' });
      return lockPath;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let holder = null;
      try {
        holder = JSON.parse(readFileSync(lockPath, 'utf8'));
      } catch {
        // Unreadable lock: treat as stale.
      }
      if (holder && isProcessAlive(holder.pid)) {
        fail(
          `another guarded run is active in this worktree: "${holder.label}" (pid ${holder.pid}, started ${holder.startedAt}).\n` +
            `[guard] Poll or terminate that run before starting a new one; do not launch a replacement command.`,
        );
      }
      rmSync(lockPath, { force: true });
    }
  }
  fail('could not acquire .guard/active.json lock');
  return null;
}

function pollTick({ child, limits, state, startedAt, terminate, killGroup }) {
  if (state.polling) return;
  state.polling = true;
  execFile('ps', ['-axo', 'pid=,ppid=,pgid=,rss='], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
    state.polling = false;
    if (state.done || error) return;
    const { totalKb, processCount } = collectTreeRssKb(stdout, child.pid);
    const rssMb = Math.round(totalKb / 1024);
    state.peakRssMb = Math.max(state.peakRssMb, rssMb);
    state.peakProcessCount = Math.max(state.peakProcessCount, processCount);
    if (state.termAt !== null) {
      if (Date.now() - state.termAt > SIGKILL_AFTER_MS || rssMb > limits.rssMb * HARD_KILL_FACTOR) {
        killGroup('SIGKILL');
      }
      return;
    }
    if (rssMb > limits.rssMb) terminate('rss-limit');
    else if (limits.timeoutS > 0 && Date.now() - startedAt > limits.timeoutS * 1000) terminate('timeout');
  });
}

function writeDiagnostics(guardDir, record) {
  try {
    writeFileSync(path.join(guardDir, 'last-run.json'), `${JSON.stringify(record, null, 2)}\n`);
    appendFileSync(path.join(guardDir, 'history.jsonl'), `${JSON.stringify(record)}\n`);
  } catch {
    // Diagnostics are best-effort.
  }
}

function main() {
  const { options, command } = parseArgs(process.argv.slice(2));
  if (command.length === 0) fail('no command given');
  if (process.env.OVERLOOK_GUARDED === '1') return passthrough(command);
  if (process.platform === 'win32' || process.env.OVERLOOK_GUARD_DISABLE === '1') {
    process.stderr.write('[guard] WARNING: guard disabled/unsupported; running unguarded.\n');
    return passthrough(command);
  }

  const limits = resolveLimits(options, process.env);
  const guardDir = path.join(process.cwd(), '.guard');
  mkdirSync(guardDir, { recursive: true });
  const lockPath = acquireLock(guardDir, options.label, command);

  const nodeOptions = [process.env.NODE_OPTIONS, `--max-old-space-size=${limits.heapMb}`].filter(Boolean).join(' ');
  const startedAt = Date.now();
  const child = spawn(command[0], command.slice(1), {
    stdio: 'inherit',
    detached: true, // new process group; kill(-pid) reaches every descendant
    env: { ...process.env, OVERLOOK_GUARDED: '1', NODE_OPTIONS: nodeOptions },
  });

  const state = { peakRssMb: 0, peakProcessCount: 0, reason: null, termAt: null, done: false };

  const killGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // Group already gone.
    }
  };

  const terminate = (reason) => {
    if (state.termAt !== null) return;
    state.reason = reason;
    state.termAt = Date.now();
    process.stderr.write(
      `[guard] ${reason}: terminating process group of "${options.label}" ` +
        `(peak RSS ${state.peakRssMb} MB, limit ${limits.rssMb} MB, ${Math.round((Date.now() - startedAt) / 1000)}s elapsed).\n`,
    );
    killGroup('SIGTERM');
  };

  const poll = setInterval(() => pollTick({ child, limits, state, startedAt, terminate, killGroup }), POLL_MS);

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      terminate(`signal:${signal}`);
    });
  }

  child.on('exit', (code, signal) => {
    state.done = true;
    clearInterval(poll);
    killGroup('SIGKILL'); // sweep any stragglers left in the group
    rmSync(lockPath, { force: true });
    writeDiagnostics(guardDir, {
      label: options.label,
      command: command.join(' '),
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      peakRssMb: state.peakRssMb,
      peakProcessCount: state.peakProcessCount,
      limits,
      exitCode: code,
      signal,
      terminationReason: state.reason ?? 'completed',
    });
    if (state.reason !== null && state.reason !== 'completed') {
      process.stderr.write(`[guard] run failed: ${state.reason} (diagnostics in .guard/last-run.json).\n`);
      process.exit(1);
    }
    process.exit(code ?? (signal ? 1 : 0));
  });

  child.on('error', (error) => {
    clearInterval(poll);
    rmSync(lockPath, { force: true });
    fail(`failed to start command: ${error.message}`);
  });
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (invokedDirectly) main();
