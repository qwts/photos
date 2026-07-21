import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const READY_MARKER = 'overlook-icloud-native-smoke:ready';
const argument = process.argv[2];
if (process.platform !== 'darwin') throw new Error('iCloud native smoke verification requires macOS');
if (argument === undefined || argument === '') {
  throw new Error('usage: node scripts/verify-macos-icloud-native-smoke.mjs /path/Overlook.app');
}

const appPath = resolve(argument);
const executable = join(appPath, 'Contents', 'MacOS', 'Overlook');
const profile = await mkdtemp(join(tmpdir(), 'overlook-icloud-native-smoke-profile-'));

try {
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(executable, ['--overlook-icloud-native-smoke', `--user-data-dir=${profile}`], {
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
      reject(new Error(`packaged app did not complete its iCloud native smoke within 60s\n${stderr}`));
    }, 60_000);
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
      `packaged iCloud native smoke failed (code=${String(result.code)}, signal=${String(result.signal)})\n${result.stdout}${result.stderr}`,
    );
  }
  console.log(`[overlook] packaged iCloud native bridge verified: ${appPath}`);
} finally {
  await rm(profile, { recursive: true, force: true });
}
