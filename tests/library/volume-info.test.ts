import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { tmpdir } from 'node:os';

import { classifyForMounts, classifyVolume, parseMountOutput } from '../../src/main/library/volume-info.js';

// #483 / ADR-0022 §5 filesystem preflight: FAT32 blocks (4 GB file cap),
// network filesystems warn-don't-block (ADR-0017 §5), deepest mount wins.

const MOUNT_OUTPUT = [
  '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)',
  'devfs on /dev (devfs, local, nobrowse)',
  '/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect)',
  '/dev/disk4s1 on /Volumes/External (apfs, local, nodev, nosuid, journaled)',
  '/dev/disk5s1 on /Volumes/OldCard (msdos, local, nodev, nosuid, noowners)',
  '/dev/disk6s1 on /Volumes/Stick (exfat, local, nodev, nosuid, noowners)',
  '//user@nas._smb._tcp.local/photos on /Volumes/NAS (smbfs, nodev, nosuid, mounted by ansel)',
  'map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)',
].join('\n');

const mounts = parseMountOutput(MOUNT_OUTPUT);

describe('destination volume classification (#483, ADR-0022 §5)', () => {
  test('parses fstype per mount point and ignores unmatchable lines', () => {
    assert.equal(mounts.length, 8);
    assert.deepEqual(mounts[3], { mountPoint: '/Volumes/External', fstype: 'apfs' });
    assert.deepEqual(parseMountOutput('garbage\n\n'), []);
  });

  test('APFS and exFAT destinations pass', () => {
    assert.deepEqual(classifyForMounts(mounts, '/Volumes/External/Overlook'), { fstype: 'apfs', blocked: null, network: false });
    assert.equal(classifyForMounts(mounts, '/Volumes/Stick/Photos').blocked, null);
  });

  test('FAT32 blocks with an actionable objection (4 GB cap)', () => {
    const result = classifyForMounts(mounts, '/Volumes/OldCard/Overlook');
    assert.equal(result.fstype, 'msdos');
    assert.match(result.blocked ?? '', /4 GB|APFS|exFAT/u);
  });

  test('network mounts warn, never block (ADR-0017 §5)', () => {
    const result = classifyForMounts(mounts, '/Volumes/NAS/photos');
    assert.equal(result.network, true);
    assert.equal(result.blocked, null);
  });

  test('the deepest containing mount wins, and exact mount-point paths match', () => {
    assert.equal(classifyForMounts(mounts, '/System/Volumes/Data/anything').fstype, 'apfs');
    assert.equal(classifyForMounts(mounts, '/Volumes/External').fstype, 'apfs');
    assert.equal(classifyForMounts(mounts, '/Volumes/Externality').fstype, 'apfs', 'prefix match respects path boundaries — falls to root');
  });

  test('an unknown location classifies as unknown, not blocked', () => {
    assert.deepEqual(classifyForMounts([], '/anywhere'), { fstype: null, blocked: null, network: false });
  });

  test('the live probe classifies the temp volume without blocking it', () => {
    const result = classifyVolume(tmpdir());
    assert.equal(typeof result.network, 'boolean');
    assert.equal(result.blocked, null, 'the CI/dev temp volume is never FAT32');
  });
});
