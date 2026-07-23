import { fullUrl } from '../../shared/library/full-url.js';
import { createTransportStreamRemux, type TransportStreamRemux } from './media/ts-remux.js';

// Offscreen poster-capture page (ADR-0026 §6). Loaded in a hidden renderer by
// the main-process OffscreenFrameCapturer: it decodes the first frame at
// presentation time zero and signals readiness through the document title —
// the main process then captures the painted page. It NEVER autoplays and
// NEVER touches stored bytes; the frame feeds the sharp derivative chain.
// Signals: "overlook-poster:ready:WxH" (frame painted) | "overlook-poster:error".

const SIGNAL_ERROR = 'overlook-poster:error';

function main(): void {
  const params = new URLSearchParams(window.location.search);
  const photoId = params.get('photo');
  const video = document.getElementById('capture');
  if (photoId === null || !(video instanceof HTMLVideoElement)) {
    document.title = SIGNAL_ERROR;
    return;
  }

  const url = fullUrl(photoId);
  let remux: TransportStreamRemux | null = null;
  let signalled = false;

  const fail = (): void => {
    if (signalled) return;
    signalled = true;
    remux?.destroy();
    document.title = SIGNAL_ERROR;
  };
  const ready = (): void => {
    if (signalled || video.videoWidth === 0 || video.readyState < 2) return;
    signalled = true;
    document.title = `overlook-poster:ready:${String(video.videoWidth)}x${String(video.videoHeight)}`;
  };

  // Seek to t=0 once data is available so the first decodable frame is painted.
  video.addEventListener('loadeddata', () => {
    try {
      video.currentTime = 0;
    } catch {
      ready();
    }
  });
  video.addEventListener('seeked', ready);
  video.addEventListener('canplay', ready);
  video.addEventListener('error', fail);

  if (params.get('ts') === '1') {
    remux = createTransportStreamRemux(video, url);
    if (remux === null) fail();
  } else {
    video.src = url;
    video.load();
  }
}

main();
