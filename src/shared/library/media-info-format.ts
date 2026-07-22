import type { MediaInfo, MediaStream } from './media-info.js';
import type { FileKind } from './types.js';

// Pure presentation helpers for probed media facts (ADR-0026 §7). Kept in
// shared so the Inspector (TSX), the grid duration pill, the import
// classification, and their unit tests all format identically — and so nothing
// is fabricated: a fact that was not probed produces no row, never a guess
// (Overlook voice: calm, factual, sentence case, mono for machine data).

/** Grid/transport duration: "0:24", shifting to "H:MM:SS" past an hour
 * (design §Edge cases: very long duration; time codes stay LTR tabular). */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${String(h)}:${String(m).padStart(2, '0')}:${ss}`;
  return `${String(m)}:${ss}`;
}

/** Inspector duration with milliseconds ("0:24.400"); omitted when unknown. */
function formatDurationPrecise(seconds: number): string {
  const whole = Math.floor(seconds);
  const ms = Math.round((seconds - whole) * 1000);
  return `${formatDuration(whole)}.${String(ms).padStart(3, '0')}`;
}

function firstOfType(streams: readonly MediaStream[], type: 'video' | 'audio'): MediaStream | undefined {
  return streams.find((s) => s.type === type);
}

/** Container brand as shown in the Inspector Container row. */
function containerLabel(info: MediaInfo): string | null {
  return info.container ?? null;
}

export interface MediaInfoRow {
  readonly label: string;
  readonly value: string;
}

/**
 * The Inspector Media section rows for a probed item, in design order (Kind,
 * Container, Video, Audio, Duration, Dimensions, Frame rate, Rotation, Color).
 * Rows whose facts were not probed are omitted — never rendered as "unknown".
 */
export function mediaInfoRows(fileKind: FileKind, info: MediaInfo | null): readonly MediaInfoRow[] {
  if (info === null || (fileKind !== 'video' && fileKind !== 'audio')) return [];
  const rows: MediaInfoRow[] = [{ label: 'Kind', value: fileKind }];
  const container = containerLabel(info);
  if (container !== null) rows.push({ label: 'Container', value: container });

  const streams = info.streams ?? [];
  const video = firstOfType(streams, 'video');
  if (video?.codec != null) {
    rows.push({ label: 'Video', value: [video.codec, video.profile].filter((p) => p != null).join(' · ') });
  }
  const audio = firstOfType(streams, 'audio');
  if (audio?.codec != null) {
    rows.push({ label: 'Audio', value: [audio.codec, audio.profile].filter((p) => p != null).join(' · ') });
  }

  if (info.durationSeconds != null) rows.push({ label: 'Duration', value: formatDurationPrecise(info.durationSeconds) });
  if (info.displayWidth != null && info.displayHeight != null) {
    rows.push({ label: 'Dimensions', value: `${String(info.displayWidth)} × ${String(info.displayHeight)}` });
  }
  if (info.frameRate != null) {
    const prefix = info.variableFrameRate === true ? 'variable ~' : '';
    rows.push({ label: 'Frame rate', value: `${prefix}${String(Math.round(info.frameRate))}` });
  }
  if (info.rotationDegrees != null && info.rotationDegrees !== 0) {
    const orientation = info.rotationDegrees === 90 || info.rotationDegrees === 270 ? ' (portrait)' : '';
    rows.push({ label: 'Rotation', value: `${String(info.rotationDegrees)}°${orientation}` });
  }
  if (info.colorTransfer != null) {
    rows.push({ label: 'Color', value: `${info.hdr === true ? 'HDR · ' : ''}${info.colorTransfer}` });
  }
  return rows;
}

/** The video codec label for the preserved-only viewer body copy ("This
 * {codec} video is saved and protected…"); falls back to "video". */
export function preservedCodecLabel(info: MediaInfo | null): string {
  const video = info === null ? undefined : firstOfType(info.streams ?? [], 'video');
  return video?.codec ?? 'video';
}
