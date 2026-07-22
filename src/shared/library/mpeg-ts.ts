import type { MediaInfo, MediaStream } from './media-info.js';

// MPEG-TS (ISO/IEC 13818-1) signature + bounded PAT/PMT probe per ADR-0026
// §2/§5/§9 (#548). Pure, dependency-free byte inspection: no demuxer, no
// decoder. Content decides classification; `.ts`/`.mts`/`.m2ts` and
// `video/mp2t` are hints only. Everything here is bounded — a hostile or
// truncated stream degrades to `probeIncomplete`, never a crawl or a throw.

/** Transport packet is 188 bytes; BDAV/M2TS prefixes each with a 4-byte
 * arrival-time header (192-byte stride). We validate both cadences. */
type TsLayout = { readonly packetSize: 188 | 192; readonly syncOffset: 0 | 4 };

const SYNC_BYTE = 0x47;
const PID_PAT = 0x0000;
const NULL_PID = 0x1fff;

/** Signature bound: sync bytes to confirm at the packet stride. A lone 0x47
 * proves nothing; a spoofed suffix can't fake a sustained cadence. */
const MIN_SYNC_PACKETS = 4;

/** Probe bounds (§9). Head/tail packet windows keep an over-budget stream from
 * turning import into a scan; caps stop a hostile PSI table or program list. */
const MAX_HEAD_PACKETS = 2400; // ~450 KiB @188 — PAT+PMT land in the first few
const MAX_TAIL_PACKETS = 2400; // last-PCR search for duration
const MAX_STREAMS = 32;
const MAX_PSI_SECTION = 1021; // ISO cap on section_length payload

/** ISO/IEC 13818-1 stream_type → (kind, codec label). Absent types are still
 * counted as preserved streams with a null codec — never dropped (§4). */
const STREAM_TYPES: Readonly<Record<number, { kind: 'video' | 'audio'; codec: string }>> = {
  0x01: { kind: 'video', codec: 'MPEG-1 Video' },
  0x02: { kind: 'video', codec: 'MPEG-2 Video' },
  0x03: { kind: 'audio', codec: 'MP2' },
  0x04: { kind: 'audio', codec: 'MP2' },
  0x0f: { kind: 'audio', codec: 'AAC' },
  0x11: { kind: 'audio', codec: 'AAC' },
  0x10: { kind: 'video', codec: 'MPEG-4 Part 2' },
  0x1b: { kind: 'video', codec: 'H.264' },
  0x24: { kind: 'video', codec: 'H.265' },
  0x81: { kind: 'audio', codec: 'AC-3' },
  0x87: { kind: 'audio', codec: 'E-AC-3' },
};

/** Codecs the §5 remux adapter can serve to `<video>` in v1. The static
 * container-matrix fact only — the per-device Playable tier is derived later
 * (§3) and lives nowhere in this record. */
const TS_REMUXABLE_VIDEO = new Set(['H.264']);
const TS_REMUXABLE_AUDIO = new Set(['AAC']);

function pidAt(bytes: Uint8Array, packetStart: number): number {
  return (((bytes[packetStart + 1] ?? 0) & 0x1f) << 8) | (bytes[packetStart + 2] ?? 0);
}

/** Detects the transport-packet cadence, or null when the bytes are not a
 * transport stream. Requires a sustained 0x47 stride so a single stray sync
 * byte (or a spoofed non-TS file) is rejected (ADR-0026 §2). */
export function detectTsLayout(bytes: Uint8Array): TsLayout | null {
  const candidates: readonly TsLayout[] = [
    { packetSize: 188, syncOffset: 0 },
    { packetSize: 192, syncOffset: 4 },
  ];
  for (const layout of candidates) {
    if (bytes[layout.syncOffset] !== SYNC_BYTE) continue;
    let confirmed = 0;
    let ran = 0;
    for (let i = 0; i < MIN_SYNC_PACKETS; i++) {
      const at = layout.syncOffset + i * layout.packetSize;
      if (at >= bytes.length) break;
      ran++;
      if (bytes[at] !== SYNC_BYTE) {
        confirmed = -1;
        break;
      }
      confirmed++;
    }
    // A full window of syncs is decisive; a short buffer passes only when every
    // present stride is a sync AND at least one whole packet is there.
    if (confirmed === MIN_SYNC_PACKETS) return layout;
    if (confirmed === ran && ran >= 1 && bytes.length >= layout.syncOffset + layout.packetSize) return layout;
  }
  return null;
}

/** Payload start for a packet, honoring the adaptation-field control bits, or
 * null when the packet carries no payload / is truncated. */
function payloadStart(bytes: Uint8Array, packetStart: number, packetEnd: number): number | null {
  const flags = bytes[packetStart + 3];
  if (flags === undefined) return null;
  const adaptation = (flags & 0x30) >> 4;
  if (adaptation === 0x00 || adaptation === 0x02) return null; // reserved / adaptation-only
  let cursor = packetStart + 4;
  if (adaptation === 0x03) {
    const adaptationLength = bytes[cursor];
    if (adaptationLength === undefined) return null;
    cursor += 1 + adaptationLength;
  }
  return cursor < packetEnd ? cursor : null;
}

/** Reads the 33-bit PCR base (90 kHz) from a packet's adaptation field, or null
 * when absent. Used only for a bounded first/last-PCR duration estimate. */
function readPcr(bytes: Uint8Array, packetStart: number): number | null {
  const flags = bytes[packetStart + 3];
  if (flags === undefined) return null;
  if ((flags & 0x30) >> 4 < 0x02) return null; // no adaptation field
  const adaptationLength = bytes[packetStart + 4];
  if (adaptationLength === undefined || adaptationLength < 7) return null;
  const adaptationFlags = bytes[packetStart + 5];
  if (adaptationFlags === undefined || (adaptationFlags & 0x10) === 0) return null; // PCR_flag
  const b = packetStart + 6;
  const b0 = bytes[b];
  const b1 = bytes[b + 1];
  const b2 = bytes[b + 2];
  const b3 = bytes[b + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) return null;
  const b4 = bytes[b + 4] ?? 0;
  // 33-bit base spans bytes 0..3 plus the top bit of byte 4. Assemble as a
  // float (safe: 2^33 < 2^53) to avoid 32-bit sign issues on the shift.
  return b0 * 2 ** 25 + b1 * 2 ** 17 + b2 * 2 ** 9 + b3 * 2 + ((b4 & 0x80) >> 7);
}

/** Gathers the PSI section bytes for a given PID out of the head window,
 * following the pointer_field on the unit-start packet. Bounded to one
 * section; returns null when it never starts or the budget is exceeded. */
function readSection(bytes: Uint8Array, layout: TsLayout, pid: number, headEnd: number): Uint8Array | null {
  for (let start = layout.syncOffset; start + layout.packetSize <= headEnd; start += layout.packetSize) {
    if (bytes[start] !== SYNC_BYTE) return null; // cadence broke — give up
    if (pidAt(bytes, start) !== pid) continue;
    const pusi = ((bytes[start + 1] ?? 0) & 0x40) !== 0;
    if (!pusi) continue;
    const payload = payloadStart(bytes, start, start + layout.packetSize);
    if (payload === null) continue;
    const pointer = bytes[payload];
    if (pointer === undefined) return null;
    const sectionStart = payload + 1 + pointer;
    const lenHi = bytes[sectionStart + 1];
    const lenLo = bytes[sectionStart + 2];
    if (lenHi === undefined || lenLo === undefined) return null;
    const sectionLength = ((lenHi & 0x0f) << 8) | lenLo;
    if (sectionLength > MAX_PSI_SECTION) return null; // hostile length
    const end = Math.min(sectionStart + 3 + sectionLength, headEnd);
    return bytes.subarray(sectionStart, end);
  }
  return null;
}

/** program_map_PID for the first program listed in a PAT section, or null. */
function firstProgramMapPid(section: Uint8Array): number | null {
  if (section[0] !== 0x00) return null; // table_id: PAT
  if (section[2] === undefined) return null;
  const length = (((section[1] ?? 0) & 0x0f) << 8) | section[2];
  const end = Math.min(3 + length - 4, section.length); // trim 4-byte CRC
  for (let i = 8; i + 4 <= end; i += 4) {
    const programNumber = ((section[i] ?? 0) << 8) | (section[i + 1] ?? 0);
    const mapPid = (((section[i + 2] ?? 0) & 0x1f) << 8) | (section[i + 3] ?? 0);
    if (programNumber !== 0) return mapPid; // skip network_PID (program 0)
  }
  return null;
}

/** Elementary streams (+ PCR_PID) from a PMT section. Bounded by MAX_STREAMS. */
function parsePmt(section: Uint8Array): { streams: MediaStream[]; pcrPid: number | null } | null {
  if (section[0] !== 0x02) return null; // table_id: PMT
  const length = (((section[1] ?? 0) & 0x0f) << 8) | (section[2] ?? 0);
  const end = Math.min(3 + length - 4, section.length);
  const pcrPid = (((section[8] ?? 0) & 0x1f) << 8) | (section[9] ?? 0);
  const programInfoLength = (((section[10] ?? 0) & 0x0f) << 8) | (section[11] ?? 0);
  let cursor = 12 + programInfoLength;
  const streams: MediaStream[] = [];
  while (cursor + 5 <= end && streams.length < MAX_STREAMS) {
    const streamType = section[cursor] ?? 0;
    const esInfoLength = (((section[cursor + 3] ?? 0) & 0x0f) << 8) | (section[cursor + 4] ?? 0);
    const mapped = STREAM_TYPES[streamType];
    streams.push({
      type: mapped?.kind ?? 'video',
      codec: mapped?.codec ?? null,
      profile: null,
    });
    cursor += 5 + esInfoLength;
  }
  return { streams, pcrPid: pcrPid === NULL_PID ? null : pcrPid };
}

/** First PCR in the head and last PCR in the tail on the PCR_PID → a bounded
 * duration estimate in seconds, or null when it can't be derived (§9). */
function estimateDuration(bytes: Uint8Array, layout: TsLayout, pcrPid: number, headEnd: number): number | null {
  let first: number | null = null;
  for (let start = layout.syncOffset; start + layout.packetSize <= headEnd; start += layout.packetSize) {
    if (bytes[start] !== SYNC_BYTE) break;
    if (pidAt(bytes, start) === pcrPid) {
      const pcr = readPcr(bytes, start);
      if (pcr !== null) {
        first = pcr;
        break;
      }
    }
  }
  if (first === null) return null;
  const tailPackets = Math.min(MAX_TAIL_PACKETS, Math.floor((bytes.length - layout.syncOffset) / layout.packetSize));
  const tailStart =
    layout.syncOffset + Math.max(0, Math.floor((bytes.length - layout.syncOffset) / layout.packetSize) - tailPackets) * layout.packetSize;
  let last: number | null = null;
  for (let start = tailStart; start + layout.packetSize <= bytes.length; start += layout.packetSize) {
    if (bytes[start] !== SYNC_BYTE) continue;
    if (pidAt(bytes, start) === pcrPid) {
      const pcr = readPcr(bytes, start);
      if (pcr !== null) last = pcr;
    }
  }
  if (last === null || last <= first) return null;
  const seconds = (last - first) / 90_000;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * Bounded PAT→PMT probe over signature-validated transport-stream bytes.
 * Records container = MPEG-TS, the elementary-stream inventory, audio presence,
 * and a best-effort PCR duration. Any budget/parse shortfall degrades to
 * `probeIncomplete` (preserved-only, "probing" placeholder) — never a throw,
 * never a partial lie (ADR-0026 §2/§9).
 */
export function probeTransportStream(bytes: Uint8Array): MediaInfo {
  const layout = detectTsLayout(bytes);
  const base: MediaInfo = {
    animated: false,
    frameCount: null,
    loopCount: null,
    container: 'MPEG-TS',
    streams: [],
    durationSeconds: null,
    codedWidth: null,
    codedHeight: null,
    displayWidth: null,
    displayHeight: null,
    rotationDegrees: null,
    frameRate: null,
    variableFrameRate: false,
    audioPresent: false,
    hdr: null,
    colorTransfer: null,
    probeIncomplete: true,
  };
  if (layout === null) return base;

  const headEnd = Math.min(bytes.length, layout.syncOffset + MAX_HEAD_PACKETS * layout.packetSize);
  const pat = readSection(bytes, layout, PID_PAT, headEnd);
  if (pat === null) return base;
  const pmtPid = firstProgramMapPid(pat);
  if (pmtPid === null) return base;
  const pmtSection = readSection(bytes, layout, pmtPid, headEnd);
  if (pmtSection === null) return base;
  const pmt = parsePmt(pmtSection);
  if (pmt === null) return base;

  const audioPresent = pmt.streams.some((s) => s.type === 'audio');
  const durationSeconds = pmt.pcrPid === null ? null : estimateDuration(bytes, layout, pmt.pcrPid, headEnd);

  return {
    ...base,
    streams: pmt.streams,
    audioPresent,
    durationSeconds,
    probeIncomplete: false,
  };
}

/** Whether a probed MPEG-TS record is remuxable-to-`<video>` in v1 (H.264 +
 * AAC only, §5). A static container-matrix fact used to seed the fixture
 * matrix — NOT the per-device Playable tier, which the runtime derives (§3). */
export function isRemuxableTransportStream(info: MediaInfo): boolean {
  if (info.container !== 'MPEG-TS' || info.probeIncomplete === true) return false;
  const streams = info.streams ?? [];
  const video = streams.filter((s) => s.type === 'video');
  const audio = streams.filter((s) => s.type === 'audio');
  if (video.length === 0) return false;
  if (!video.every((s) => s.codec !== null && TS_REMUXABLE_VIDEO.has(s.codec))) return false;
  if (!audio.every((s) => s.codec !== null && TS_REMUXABLE_AUDIO.has(s.codec))) return false;
  return true;
}
