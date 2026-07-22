import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { detectTsLayout, probeTransportStream, isRemuxableTransportStream } from '../../src/shared/library/mpeg-ts.js';
import { sniffVideoKind, sniffImageKind, probeMediaInfo } from '../../src/shared/library/media-signatures.js';
import { classifyMediaFile } from '../../src/shared/library/media-files.js';
import { derivePlayability, type DeviceMediaCapabilities } from '../../src/shared/library/playability.js';

const FIXTURES = join(import.meta.dirname, '../../../tests/fixtures/video');
const read = (name: string): Buffer => readFileSync(join(FIXTURES, name));
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

// Fixture matrix (ADR-0026 §Consequences: a row without a fixture is not a
// supported claim). Hashes are recorded so a silent re-encode is caught.
const supported = read('supported-h264-aac.ts');
const preserved = read('preserved-mpeg2-mp2.ts');
const truncated = read('truncated-h264-aac.ts');
const spoofed = read('spoofed-jpeg.ts');
const malformed = read('malformed-no-cadence.ts');

const HASHES: Readonly<Record<string, string>> = {
  'supported-h264-aac.ts': 'a327f9d90565a7672ce85ac341066e0da7ea89caf9b053c32352ece756dfd754',
  'preserved-mpeg2-mp2.ts': '095b7bfb8cfb4f4eaaa37bc7600a5870b3d3a8561769bcbdaa17e6603fb4a756',
  'truncated-h264-aac.ts': 'f9501eddbe99dcb75e6414e32ac4e4b2b59cdc347eaa23b1e5c426507c567b59',
  'spoofed-jpeg.ts': '5fefb55d3e27603a91f828fcb10e8529f8cde7ce010c08391ea8b79af72d54bb',
  'malformed-no-cadence.ts': 'b6cc9cd43bccd931dfa90c073ed79946d2f7b6ec7982951b5fe655f23505cfc4',
};

describe('MPEG-TS fixture identity (I1: originals never drift)', () => {
  for (const [name, hash] of Object.entries(HASHES)) {
    test(`${name} matches its recorded hash`, () => {
      assert.equal(sha256(read(name)), hash);
    });
  }
});

describe('detectTsLayout — signature by 0x47 cadence (ADR-0026 §2)', () => {
  test('accepts a real 188-byte transport stream', () => {
    assert.deepEqual(detectTsLayout(supported), { packetSize: 188, syncOffset: 0 });
    assert.deepEqual(detectTsLayout(preserved), { packetSize: 188, syncOffset: 0 });
  });

  test('accepts the 192-byte (M2TS) cadence', () => {
    const m2ts = new Uint8Array(192 * 5);
    for (let i = 0; i < 5; i++) m2ts[i * 192 + 4] = 0x47;
    assert.deepEqual(detectTsLayout(m2ts), { packetSize: 192, syncOffset: 4 });
  });

  test('rejects a lone sync byte and non-TS content', () => {
    assert.equal(detectTsLayout(malformed), null); // 0x47 then noise
    assert.equal(detectTsLayout(spoofed), null); // real JPEG
    assert.equal(detectTsLayout(new Uint8Array([0x47])), null); // too short for a packet
    assert.equal(detectTsLayout(new Uint8Array(0)), null);
  });

  test('a spoofed suffix cannot fake a sustained cadence', () => {
    const fake = new Uint8Array(200).fill(0);
    fake[0] = 0x47; // one sync, then zeros — stride 188 is not a sync
    assert.equal(detectTsLayout(fake), null);
  });
});

describe('probeTransportStream — bounded PAT/PMT probe (§2/§9)', () => {
  test('records container, streams, audio presence, and duration for H.264+AAC', () => {
    const info = probeTransportStream(supported);
    assert.equal(info.container, 'MPEG-TS');
    assert.equal(info.probeIncomplete, false);
    assert.equal(info.audioPresent, true);
    const codecs = (info.streams ?? []).map((s) => s.codec).sort();
    assert.deepEqual(codecs, ['AAC', 'H.264']);
    assert.ok((info.durationSeconds ?? 0) > 0, 'derives a positive PCR duration');
  });

  test('records preserved-only codecs without misreporting them', () => {
    const info = probeTransportStream(preserved);
    assert.equal(info.container, 'MPEG-TS');
    assert.equal(info.probeIncomplete, false);
    const codecs = (info.streams ?? []).map((s) => s.codec).sort();
    assert.deepEqual(codecs, ['MP2', 'MPEG-2 Video']);
  });

  test('a signature-valid but PSI-incomplete stream degrades to probeIncomplete', () => {
    const info = probeTransportStream(truncated);
    assert.equal(info.container, 'MPEG-TS');
    assert.equal(info.probeIncomplete, true);
    assert.deepEqual(info.streams, []);
  });

  test('never throws on non-TS bytes; returns a probe-incomplete record', () => {
    const info = probeTransportStream(malformed);
    assert.equal(info.probeIncomplete, true);
  });

  test('a PMT that spans packets is reassembled, not parsed from a truncated prefix', () => {
    // Build a program whose PMT is pushed past one packet by a large
    // program-info descriptor block; the ES loop (H.264 + AAC) lands in the
    // continuation packet. A prefix-only parse would miss both streams.
    const patSection = [0x00, 0xb0, 0x0d, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe1, 0x00, 0, 0, 0, 0];
    const descriptorLen = 160; // forces the ES loop into a second packet
    const esLoop = [0x1b, 0xe1, 0x01, 0xf0, 0x00, 0x0f, 0xe1, 0x02, 0xf0, 0x00];
    const pmtBody = [
      0xe1,
      0x00, // reserved + PCR_PID 0x0100
      0xf0 | ((descriptorLen >> 8) & 0x0f),
      descriptorLen & 0xff,
      ...Array.from({ length: descriptorLen }, () => 0x00),
      ...esLoop,
    ];
    const sectionLength = 5 + pmtBody.length + 4; // program_number..last + body + CRC
    const pmtSection = [
      0x02,
      0xb0 | ((sectionLength >> 8) & 0x0f),
      sectionLength & 0xff,
      0x00,
      0x01,
      0xc1,
      0x00,
      0x00,
      ...pmtBody,
      0,
      0,
      0,
      0,
    ];

    const packet = (pid: number, pusi: boolean, payload: readonly number[]): number[] => {
      const head = [0x47, ((pusi ? 0x40 : 0) | ((pid >> 8) & 0x1f)) & 0xff, pid & 0xff, 0x10];
      const body = [...(pusi ? [0x00] : []), ...payload];
      return [...head, ...body, ...Array.from({ length: 188 - head.length - body.length }, () => 0xff)];
    };
    // The section is longer than one packet payload; split across two PID-0x0100 packets.
    const firstFill = 184 - 1; // payload capacity after the pointer byte
    const stream = new Uint8Array([
      ...packet(0x0000, true, patSection),
      ...packet(0x0100, true, pmtSection.slice(0, firstFill)),
      ...[
        0x47,
        0x01,
        0x00,
        0x10,
        ...pmtSection.slice(firstFill),
        ...Array.from({ length: 184 - (pmtSection.length - firstFill) }, () => 0xff),
      ],
    ]);
    const info = probeTransportStream(stream);
    assert.equal(info.probeIncomplete, false, 'reassembled section is complete');
    assert.deepEqual((info.streams ?? []).map((s) => s.codec).sort(), ['AAC', 'H.264']);
  });
});

describe('classification is by signature, never suffix (I2)', () => {
  test('.ts/.mts/.m2ts are import candidates', () => {
    assert.equal(classifyMediaFile('clip.ts'), 'video');
    assert.equal(classifyMediaFile('recording.MTS'), 'video');
    assert.equal(classifyMediaFile('camcorder.m2ts'), 'video');
  });

  test('a real transport stream sniffs as video', () => {
    assert.equal(sniffVideoKind(supported), 'video');
    assert.equal(sniffVideoKind(preserved), 'video');
  });

  test('a JPEG carrying a .ts name is classified by content, not the suffix', () => {
    assert.equal(sniffVideoKind(spoofed), null);
    assert.equal(sniffImageKind(spoofed), 'jpeg');
  });

  test('probeMediaInfo routes the video kind to the TS probe', () => {
    const info = probeMediaInfo(supported, 'video');
    assert.equal(info?.container, 'MPEG-TS');
    assert.equal(probeMediaInfo(spoofed, 'video'), null); // bytes are not a TS
  });
});

describe('isRemuxableTransportStream — static §5 matrix fact', () => {
  test('H.264 + AAC is remuxable; MPEG-2 + MP2 is not', () => {
    assert.equal(isRemuxableTransportStream(probeTransportStream(supported)), true);
    assert.equal(isRemuxableTransportStream(probeTransportStream(preserved)), false);
  });

  test('a probe-incomplete record is never remuxable', () => {
    assert.equal(isRemuxableTransportStream(probeTransportStream(truncated)), false);
  });
});

describe('derivePlayability — per device, never persisted (§3)', () => {
  const allCodecs: DeviceMediaCapabilities = { canDecodeCodec: () => true, transportStreamRemuxAvailable: true };
  const noRemux: DeviceMediaCapabilities = { canDecodeCodec: () => true, transportStreamRemuxAvailable: false };

  test('supported H.264+AAC is Playable where the remux adapter and decoders exist', () => {
    assert.equal(derivePlayability('video', probeTransportStream(supported), allCodecs), 'playable');
  });

  test('same item is Preserved-only without the remux adapter — tier is per device', () => {
    assert.equal(derivePlayability('video', probeTransportStream(supported), noRemux), 'preserved-only');
  });

  test('MPEG-2/MP2 is Preserved-only even with full decoders (non-remuxable container)', () => {
    assert.equal(derivePlayability('video', probeTransportStream(preserved), allCodecs), 'preserved-only');
  });

  test('decodable video + undecodable audio is Preserved-only, never half-played', () => {
    const info = probeTransportStream(supported);
    const videoOnlyDecoder: DeviceMediaCapabilities = {
      canDecodeCodec: (codec) => codec === 'H.264',
      transportStreamRemuxAvailable: true,
    };
    assert.equal(derivePlayability('video', info, videoOnlyDecoder), 'preserved-only');
  });

  test('probe-incomplete and audio kind are Preserved-only', () => {
    assert.equal(derivePlayability('video', probeTransportStream(truncated), allCodecs), 'preserved-only');
    assert.equal(derivePlayability('audio', probeTransportStream(supported), allCodecs), 'preserved-only');
  });
});
