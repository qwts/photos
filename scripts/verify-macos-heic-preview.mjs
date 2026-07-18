import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const READY_MARKER = 'overlook-heic-smoke:ready:3024x4032';
const appPath = process.argv[2];
const fixturePath = process.argv[3];
if (process.platform !== 'darwin') throw new Error('macOS HEIC verification requires macOS');
if (appPath === undefined || fixturePath === undefined) {
  throw new Error('usage: node scripts/verify-macos-heic-preview.mjs /path/Overlook.app /path/fixture.heic');
}

const resolvedApp = resolve(appPath);
const resolvedFixture = resolve(fixturePath);
const executableName = execFileSync('plutil', ['-extract', 'CFBundleExecutable', 'raw', join(resolvedApp, 'Contents', 'Info.plist')], {
  encoding: 'utf8',
}).trim();
const executable = join(resolvedApp, 'Contents', 'MacOS', executableName);
const profile = await mkdtemp(join(tmpdir(), 'overlook-heic-smoke-'));

try {
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(executable, [`--overlook-heic-smoke=${resolvedFixture}`, `--user-data-dir=${profile}`], {
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
      reject(new Error(`packaged app did not decode the HEIC fixture within 30s\n${stdout}${stderr}`));
    }, 30_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolveResult({ code, signal, stdout, stderr });
    });
  });

  if (result.code !== 0 || result.signal !== null || !result.stdout.includes(READY_MARKER)) {
    throw new Error(
      `packaged HEIC decode failed (code=${String(result.code)}, signal=${String(result.signal)})\n${result.stdout}${result.stderr}`,
    );
  }
  console.log(`[overlook] packaged HEIC preview verified: ${resolvedApp}`);
} finally {
  await rm(profile, { recursive: true, force: true });
}
