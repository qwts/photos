import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { formatDuration, mediaInfoRows, preservedCodecLabel } from '../../src/shared/library/media-info-format.js';
import type { MediaInfo } from '../../src/shared/library/media-info.js';

const tsInfo: MediaInfo = {
  animated: false,
  frameCount: null,
  loopCount: null,
  container: 'MPEG-TS',
  streams: [
    { type: 'video', codec: 'H.264', profile: null },
    { type: 'audio', codec: 'AAC', profile: null },
  ],
  durationSeconds: 24.4,
  codedWidth: null,
  codedHeight: null,
  displayWidth: null,
  displayHeight: null,
  rotationDegrees: null,
  frameRate: null,
  variableFrameRate: false,
  audioPresent: true,
  hdr: null,
  colorTransfer: null,
  probeIncomplete: false,
};

describe('formatDuration (design §Grid tiles / §Edge cases)', () => {
  test('M:SS under an hour, H:MM:SS past it', () => {
    assert.equal(formatDuration(24), '0:24');
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(65), '1:05');
    assert.equal(formatDuration(3661), '1:01:01');
    assert.equal(formatDuration(-5), '0:00'); // never negative
  });
});

describe('mediaInfoRows — probed facts, never fabricated (§7)', () => {
  test('MPEG-TS records the rows it can probe and omits the rest', () => {
    const rows = mediaInfoRows('video', tsInfo);
    assert.deepEqual(rows, [
      { label: 'Kind', value: 'video' },
      { label: 'Container', value: 'MPEG-TS' },
      { label: 'Video', value: 'H.264' },
      { label: 'Audio', value: 'AAC' },
      { label: 'Duration', value: '0:24.400' },
    ]);
    // No dimensions/frame rate/rotation/color rows — those facts were not probed.
    assert.equal(
      rows.some((r) => ['Dimensions', 'Frame rate', 'Rotation', 'Color'].includes(r.label)),
      false,
    );
  });

  test('renders profile, dimensions, VFR, rotation, and HDR when present (iPhone case)', () => {
    const rich: MediaInfo = {
      ...tsInfo,
      container: 'QuickTime',
      streams: [
        { type: 'video', codec: 'HEVC', profile: 'Main10' },
        { type: 'audio', codec: 'AAC', profile: null },
      ],
      displayWidth: 1080,
      displayHeight: 1920,
      frameRate: 30,
      variableFrameRate: true,
      rotationDegrees: 90,
      hdr: true,
      colorTransfer: 'BT.2020 PQ',
    };
    const rows = mediaInfoRows('video', rich);
    assert.deepEqual(
      rows.find((r) => r.label === 'Video'),
      { label: 'Video', value: 'HEVC · Main10' },
    );
    assert.deepEqual(
      rows.find((r) => r.label === 'Dimensions'),
      { label: 'Dimensions', value: '1080 × 1920' },
    );
    assert.deepEqual(
      rows.find((r) => r.label === 'Frame rate'),
      { label: 'Frame rate', value: 'variable ~30' },
    );
    assert.deepEqual(
      rows.find((r) => r.label === 'Rotation'),
      { label: 'Rotation', value: '90° (portrait)' },
    );
    assert.deepEqual(
      rows.find((r) => r.label === 'Color'),
      { label: 'Color', value: 'HDR · BT.2020 PQ' },
    );
  });

  test('stills and null media-info produce no rows', () => {
    assert.deepEqual(mediaInfoRows('jpeg', tsInfo), []);
    assert.deepEqual(mediaInfoRows('video', null), []);
  });
});

describe('preservedCodecLabel — viewer body copy', () => {
  test('uses the video codec, falling back to "video"', () => {
    assert.equal(preservedCodecLabel(tsInfo), 'H.264');
    assert.equal(preservedCodecLabel(null), 'video');
    assert.equal(preservedCodecLabel({ ...tsInfo, streams: [] }), 'video');
  });
});
