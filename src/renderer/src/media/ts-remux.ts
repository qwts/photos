import mpegts from 'mpegts.js';

// ADR-0026 §5: MPEG-TS is not servable to <video> directly. Its playable rows
// go through a renderer-side bounded remux adapter (TS → fragmented MP4 via
// MediaSource), H.264 + AAC only in v1. The adapter is isolated behind this
// interface so the concrete dependency (mpegts.js, Apache-2.0 — exact-pinned
// and license-gated) never leaks into the player. Remuxing is a playback
// transport detail; it never touches stored bytes.

export interface TransportStreamRemux {
  /** Begin buffering + playback of the attached element. */
  play: () => Promise<void>;
  pause: () => void;
  /** Tear down the player and detach from the media element. */
  destroy: () => void;
}

/** Whether the platform can run the remux path this session: MSE plus fragmented
 * MP4 decode for the v1 H.264 + AAC matrix. No mpegts.js call is needed to
 * answer this, so capability checks stay import-light. */
export function canRemuxTransportStream(): boolean {
  if (typeof window === 'undefined' || typeof window.MediaSource === 'undefined') return false;
  return window.MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"');
}

/**
 * Attaches an MPEG-TS remux player to `video`, streaming `url` (a Range-capable
 * overlook-full:// original) and feeding fragmented MP4 to MediaSource. Returns
 * null when the platform cannot support the path (caller falls back to the
 * preserved-only surface). Errors surface through the element's `error` event,
 * which the player already handles.
 */
export function createTransportStreamRemux(video: HTMLVideoElement, url: string): TransportStreamRemux | null {
  if (!canRemuxTransportStream() || !mpegts.isSupported()) return null;
  const player = mpegts.createPlayer(
    { type: 'mpegts', url, isLive: false, cors: true },
    // Bounded buffering (§9): cap look-ahead so a hostile stream can't grow the
    // MSE buffer without limit; let the element's own error path surface faults.
    { lazyLoad: true, lazyLoadMaxDuration: 30, enableStashBuffer: true, stashInitialSize: 1024 },
  );
  player.attachMediaElement(video);
  player.load();
  let destroyed = false;
  return {
    play: () => (destroyed ? Promise.resolve() : Promise.resolve(player.play()).then(() => undefined)),
    pause: () => {
      if (!destroyed) player.pause();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      player.pause();
      player.unload();
      player.detachMediaElement();
      player.destroy();
    },
  };
}
