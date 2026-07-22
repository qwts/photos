#!/usr/bin/env node

// Verify the machine architecture of every executable payload in a packaged
// Windows build (#683). Cross-compiling arm64 on the x64 `windows-latest`
// runner only ships arm64 binaries if electron-builder pulled the arm64
// Electron download and the `--arch` flag propagated to every native prebuild
// (sharp, encrypted SQLite). electron-builder *warns* rather than fails when a
// prebuild is missing for the target arch and silently falls back to the host
// build, so a mixed-architecture artifact is a real failure mode. This reads
// the PE header of the installed `Overlook.exe` and every shipped `*.node` and
// asserts they all match the requested architecture.
//
// The NSIS installer stub itself is deliberately NOT checked: upstream ships no
// arm64 stub, so the outer installer `.exe` stays PE32 i386 and runs the arm64
// payload under emulation. This verifier targets the *unpacked* app tree
// (`release/win-unpacked`), i.e. what actually lands on disk after install.

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// COFF machine types (PE\0\0 header, IMAGE_FILE_HEADER.Machine). Only the two
// architectures Overlook ships are enumerated; anything else is a hard failure.
export const MACHINE_BY_ARCH = Object.freeze({ x64: 0x8664, arm64: 0xaa64 });

// Reverse map plus the two architectures we explicitly want to name when they
// show up where they should not (a leaked x64 payload in an arm64 build, or the
// i386 installer stub sneaking into the checked set).
export const MACHINE_NAMES = Object.freeze({
  0x8664: 'x64 (0x8664)',
  0xaa64: 'arm64 (0xAA64)',
  0x14c: 'i386 (0x14c)',
  0x1c0: 'arm (0x1c0)',
  0x200: 'ia64 (0x200)',
});

export function machineName(machine) {
  return MACHINE_NAMES[machine] ?? `unknown (0x${machine.toString(16)})`;
}

/**
 * Read the COFF machine field from a PE (Portable Executable) file buffer.
 * Throws if the buffer is not a well-formed PE image.
 */
export function readPeMachine(buffer) {
  // DOS header: "MZ" magic, then a little-endian pointer to the PE header at
  // offset 0x3C.
  if (buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5a4d) {
    throw new Error('not a PE image: missing MZ signature');
  }
  const peOffset = buffer.readUInt32LE(0x3c);
  // Need "PE\0\0" (4 bytes) + at least the 2-byte Machine field after it.
  if (peOffset + 6 > buffer.length) {
    throw new Error('not a PE image: PE header offset past end of file');
  }
  if (buffer.readUInt32LE(peOffset) !== 0x0000_4550) {
    throw new Error('not a PE image: missing PE signature');
  }
  return buffer.readUInt16LE(peOffset + 4);
}

/**
 * Assert a single PE buffer matches the expected architecture. Returns nothing;
 * throws with a labelled message on mismatch so the caller can aggregate.
 */
export function assertBufferArch(buffer, expectedArch, label) {
  const expected = MACHINE_BY_ARCH[expectedArch];
  if (expected === undefined) {
    throw new Error(`unknown target architecture "${expectedArch}" (expected one of ${Object.keys(MACHINE_BY_ARCH).join(', ')})`);
  }
  const actual = readPeMachine(buffer);
  if (actual !== expected) {
    throw new Error(`${label}: expected ${machineName(expected)} but found ${machineName(actual)}`);
  }
}

// Recursively collect the payloads whose architecture must match: the app
// executable(s) and every native Node-API addon.
async function collectPayloads(dir) {
  const payloads = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      payloads.push(...(await collectPayloads(full)));
      continue;
    }
    const lower = entry.name.toLowerCase();
    if (lower.endsWith('.node') || lower === 'overlook.exe') {
      payloads.push(full);
    }
  }
  return payloads;
}

/**
 * Locate the electron-builder unpacked app directory for a build. The default
 * (x64) arch lands in `win-unpacked`; every other arch gets an arch suffix
 * (`win-arm64-unpacked`). To stay robust across electron-builder versions, an
 * explicit directory wins; otherwise prefer the arch-appropriate name and fall
 * back to the sole `win*-unpacked` directory present (each leg builds one arch).
 */
export async function resolveUnpackedDir(releaseDir, arch, explicit) {
  if (explicit !== undefined && explicit !== '') return resolve(explicit);
  const named = arch === 'x64' ? 'win-unpacked' : `win-${arch}-unpacked`;
  const preferred = join(releaseDir, named);
  if (existsSync(preferred)) return preferred;
  let entries;
  try {
    entries = await readdir(releaseDir, { withFileTypes: true });
  } catch {
    throw new Error(`release directory ${releaseDir} not found`);
  }
  const unpacked = entries.filter((entry) => entry.isDirectory() && /^win.*-unpacked$/u.test(entry.name)).map((entry) => entry.name);
  if (unpacked.length === 1) return join(releaseDir, unpacked[0]);
  throw new Error(
    unpacked.length === 0
      ? `no win*-unpacked directory found under ${releaseDir}`
      : `ambiguous unpacked directories under ${releaseDir}: ${unpacked.join(', ')}`,
  );
}

async function main() {
  const arch = process.argv[2];
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error('usage: node scripts/verify-windows-arch.mjs <x64|arm64> [unpacked-dir]');
  }
  const dir = await resolveUnpackedDir(resolve('release'), arch, process.argv[3]);
  const payloads = (await collectPayloads(dir)).sort();
  if (payloads.length === 0) {
    throw new Error(`no Overlook.exe or *.node payloads found under ${dir}`);
  }
  const failures = [];
  let checkedExe = false;
  for (const payload of payloads) {
    if (payload.toLowerCase().endsWith('overlook.exe')) checkedExe = true;
    try {
      assertBufferArch(await readFile(payload), arch, payload);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (!checkedExe) {
    failures.push(`Overlook.exe not found under ${dir}: cannot confirm the app executable architecture`);
  }
  if (failures.length > 0) {
    throw new Error(`Windows ${arch} architecture verification failed:\n  - ${failures.join('\n  - ')}`);
  }
  process.stdout.write(`Windows ${arch} architecture verified across ${payloads.length} payload(s).\n`);
}

// Only run the CLI when invoked directly, so the pure helpers can be imported
// by the unit tests without touching the filesystem. Use fileURLToPath, NOT
// new URL(...).pathname: on Windows the latter yields a leading-slash, forward-
// slash path (/C:/...) that never equals the resolved argv[1] (C:\...), which
// would silently skip main() and disable the arch gate on the Windows legs.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
