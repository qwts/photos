import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const MARKER = 'overlook-icloud-live-contract:evidence:';
const argument = process.argv[2];
if (process.platform !== 'darwin') throw new Error('iCloud live contract requires macOS');
if (argument === undefined || argument === '') {
  throw new Error('usage: npm run test:icloud:live -- /path/Overlook.app');
}

const appPath = resolve(argument);
const executable = join(appPath, 'Contents', 'MacOS', 'Overlook');
const profile = mkdtempSync(join(tmpdir(), 'overlook-icloud-live-profile-'));
const evidencePath = resolve(process.env['OVERLOOK_ICLOUD_EVIDENCE'] ?? 'test-results/icloud-live-contract-evidence.json');
const startedAt = new Date();

function commandOutput(command, args, options = {}) {
  return String(execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })).trim();
}

function signingIdentity() {
  const inspected = spawnSync('codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' });
  const values = Object.fromEntries(
    String(inspected.stderr)
      .split('\n')
      .map((line) => /^(Authority|Identifier|TeamIdentifier)=(.+)$/u.exec(line))
      .filter((match) => match !== null)
      .map((match) => [match[1], match[2]]),
  );
  return {
    authority: values.Authority ?? null,
    identifier: values.Identifier ?? null,
    teamIdentifier: values.TeamIdentifier ?? null,
  };
}

try {
  commandOutput(process.execPath, ['scripts/verify-macos-provisioned-app.mjs', appPath]);
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(executable, ['--overlook-icloud-live-contract', `--user-data-dir=${profile}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('packaged iCloud live contract did not complete within 15 minutes'));
    }, 15 * 60_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolveResult({ code, signal, stdout, stderr });
    });
  });
  const marker = result.stdout.split('\n').find((line) => line.startsWith(MARKER));
  if (marker === undefined) throw new Error(`packaged app emitted no live-contract evidence\n${result.stderr}`);
  const contract = JSON.parse(marker.slice(MARKER.length));
  const completedAt = new Date();
  const evidence = {
    schema: 1,
    issue: 659,
    commit: process.env['OVERLOOK_ICLOUD_ARTIFACT_COMMIT'] ?? commandOutput('git', ['rev-parse', 'HEAD']),
    artifact: {
      executableSha256: createHash('sha256').update(readFileSync(executable)).digest('hex'),
      ...signingIdentity(),
      applicationIdentifier: 'Z5DM34QS5U.com.zts1.overlook',
      iCloudContainer: 'iCloud.com.zts1.overlook',
    },
    command: 'npm run test:icloud:live -- /path/Overlook.app',
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    exit: { code: result.code, signal: result.signal },
    contract,
  };
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  if (result.code !== 0 || result.signal !== null || contract.result !== 'pass' || contract.cleanup !== true) {
    throw new Error(`signed iCloud live contract failed; redacted evidence: ${evidencePath}`);
  }
  console.log(`[overlook] signed iCloud live contract passed; redacted evidence: ${evidencePath}`);
} finally {
  rmSync(profile, { recursive: true, force: true });
}
