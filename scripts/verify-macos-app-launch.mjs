import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const READY_MARKER = 'overlook-release-smoke:ready';
const artifact = process.argv[2];
if (process.platform !== 'darwin') throw new Error('macOS app launch verification requires macOS');
if (artifact === undefined || artifact === '') {
  throw new Error('usage: node scripts/verify-macos-app-launch.mjs /path/Overlook.app|Overlook-mac.zip');
}

const artifactPath = resolve(artifact);
const extraction = extname(artifactPath) === '.zip' ? await mkdtemp(join(tmpdir(), 'overlook-release-artifact-')) : undefined;
if (extraction !== undefined) execFileSync('ditto', ['-x', '-k', artifactPath, extraction]);
const appPath = extraction === undefined ? artifactPath : await findApp(extraction);
const executableName = execFileSync('plutil', ['-extract', 'CFBundleExecutable', 'raw', join(appPath, 'Contents', 'Info.plist')], {
  encoding: 'utf8',
}).trim();
const executable = join(appPath, 'Contents', 'MacOS', executableName);
const profile = await mkdtemp(join(tmpdir(), 'overlook-release-smoke-'));

try {
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(executable, ['--overlook-release-smoke', `--user-data-dir=${profile}`], {
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
      reject(new Error(`packaged app did not complete its launch smoke test within 20s\n${stderr}`));
    }, 20_000);
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
      `packaged app launch failed (code=${String(result.code)}, signal=${String(result.signal)})\n${result.stdout}${result.stderr}`,
    );
  }
  console.log(`[overlook] packaged app launch verified: ${artifactPath}`);
} finally {
  await rm(profile, { recursive: true, force: true });
  if (extraction !== undefined) await rm(extraction, { recursive: true, force: true });
}

async function findApp(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = join(directory, entry.name);
    if (entry.isDirectory() && entry.name.endsWith('.app')) return candidate;
    if (entry.isDirectory()) {
      const nested = await findApp(candidate);
      if (nested !== undefined) return nested;
    }
  }
  if (directory.endsWith('.app')) return directory;
  if (directory === extraction) throw new Error(`release archive contains no macOS app: ${artifactPath}`);
  return undefined;
}
