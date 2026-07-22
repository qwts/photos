import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const root = process.cwd();

interface WindowsArchModule {
  readonly MACHINE_BY_ARCH: { readonly x64: number; readonly arm64: number };
  readonly readPeMachine: (buffer: Buffer) => number;
  readonly assertBufferArch: (buffer: Buffer, expectedArch: string, label: string) => void;
  readonly machineName: (machine: number) => string;
  readonly resolveUnpackedDir: (releaseDir: string, arch: string, explicit?: string) => Promise<string>;
}

function windowsArchModule(): Promise<WindowsArchModule> {
  return import(pathToFileURL(join(root, 'scripts/verify-windows-arch.mjs')).href) as Promise<WindowsArchModule>;
}

// Build a minimal-but-valid PE image carrying a given COFF machine type. The PE
// header is placed at offset 0x80; 0x3C holds the little-endian pointer to it.
function pe(machine: number): Buffer {
  const buffer = Buffer.alloc(0x90);
  buffer.writeUInt16LE(0x5a4d, 0); // "MZ"
  const peOffset = 0x80;
  buffer.writeUInt32LE(peOffset, 0x3c);
  buffer.writeUInt32LE(0x0000_4550, peOffset); // "PE\0\0"
  buffer.writeUInt16LE(machine, peOffset + 4);
  return buffer;
}

describe('Windows arch verification (#683)', () => {
  test('reads the COFF machine field for x64 and arm64 images', async () => {
    const { readPeMachine, MACHINE_BY_ARCH } = await windowsArchModule();
    assert.equal(readPeMachine(pe(MACHINE_BY_ARCH.x64)), 0x8664);
    assert.equal(readPeMachine(pe(MACHINE_BY_ARCH.arm64)), 0xaa64);
  });

  test('accepts a buffer whose architecture matches the target', async () => {
    const { assertBufferArch, MACHINE_BY_ARCH } = await windowsArchModule();
    assert.doesNotThrow(() => assertBufferArch(pe(MACHINE_BY_ARCH.arm64), 'arm64', 'Overlook.exe'));
    assert.doesNotThrow(() => assertBufferArch(pe(MACHINE_BY_ARCH.x64), 'x64', 'Overlook.exe'));
  });

  test('rejects a host-arch payload leaking into a cross-compiled build', async () => {
    const { assertBufferArch, MACHINE_BY_ARCH } = await windowsArchModule();
    // The exact failure mode the verifier exists to catch: an x64 prebuild left
    // behind in an arm64 build because the arm64 prebuild was missing.
    assert.throws(
      () => assertBufferArch(pe(MACHINE_BY_ARCH.x64), 'arm64', 'sharp.node'),
      /sharp\.node: expected arm64 \(0xAA64\) but found x64 \(0x8664\)/u,
    );
    assert.throws(() => assertBufferArch(pe(0x14c), 'x64', 'stub.exe'), /found i386 \(0x14c\)/u);
  });

  test('rejects buffers that are not PE images', async () => {
    const { readPeMachine } = await windowsArchModule();
    assert.throws(() => readPeMachine(Buffer.alloc(0x40)), /missing MZ signature/u);
    const noPeSig = pe(0x8664);
    noPeSig.writeUInt32LE(0, 0x80); // clobber the "PE\0\0" signature
    assert.throws(() => readPeMachine(noPeSig), /missing PE signature/u);
  });

  test('rejects an unknown target architecture', async () => {
    const { assertBufferArch, MACHINE_BY_ARCH } = await windowsArchModule();
    assert.throws(() => assertBufferArch(pe(MACHINE_BY_ARCH.x64), 'riscv', 'x'), /unknown target architecture "riscv"/u);
  });

  test('resolves the arch-specific electron-builder unpacked directory', async () => {
    const { resolveUnpackedDir } = await windowsArchModule();
    // arm64 gets the arch suffix; x64 (the default arch) does not.
    const release = mkdtempSync(join(tmpdir(), 'overlook-release-'));
    mkdirSync(join(release, 'win-arm64-unpacked'));
    assert.equal(await resolveUnpackedDir(release, 'arm64'), join(release, 'win-arm64-unpacked'));
    // Falls back to the sole win*-unpacked dir when the preferred name is absent
    // (guards against electron-builder naming drift); still unambiguous per leg.
    assert.equal(await resolveUnpackedDir(release, 'x64'), join(release, 'win-arm64-unpacked'));
    // An explicit path always wins.
    assert.equal(await resolveUnpackedDir(release, 'arm64', '/tmp/explicit'), '/tmp/explicit');
  });

  test('fails when no unpacked directory is present', async () => {
    const { resolveUnpackedDir } = await windowsArchModule();
    const release = mkdtempSync(join(tmpdir(), 'overlook-release-empty-'));
    await assert.rejects(() => resolveUnpackedDir(release, 'arm64'), /no win\*-unpacked directory found/u);
  });
});
