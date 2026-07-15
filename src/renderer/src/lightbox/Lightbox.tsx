import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { fullUrl } from '../../../shared/library/full-url.js';
import { IconButton } from '../components/IconButton';
import type { PhotoRecord } from '../../../shared/library/types.js';

import './lightbox.css';

// Lightbox (#92, README §3): image-first, chrome that gets out of the way.
// The photo arrives decrypted in memory over overlook-full:// (#91); RAW
// records render their embedded preview (ADR-0006), badged PREVIEW. Chrome
// fades in on mousemove and auto-hides after 2.2s idle (200ms ease-out
// fades), waking on photo change. Keyboard lands with #93, Inspector with
// #94; delete stays a disabled stub until M10's soft-delete.

const CHROME_IDLE_MS = 2200;

export interface LightboxProps {
  readonly photo: PhotoRecord;
  readonly onClose: () => void;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onToggleFavorite: () => void;
  readonly inspectorOpen: boolean;
  readonly onToggleInspector: () => void;
  /** Export dialog arrives with M07 (count=1); stub until then. */
  readonly onExport: () => void;
  /** Opens verified offload preflight for this photo. */
  readonly onOffload: () => void;
  /** Rehydrate failed — the host shows the red toast (#107). */
  readonly onRehydrateError?: (() => void) | undefined;
  /** Soft-deletes this photo (#120) — the row leaving the visible set
   * closes the lightbox via the reducer's intersection rule. */
  readonly onDelete: () => void;
}

/** The bottom strip's EXIF line — only what the file actually states. */
function exifStrip(photo: PhotoRecord): string {
  const parts = [
    photo.camera,
    photo.aperture === null ? null : `ƒ/${photo.aperture}`,
    photo.shutter === null ? null : `${photo.shutter}S`,
    photo.iso === null ? null : `ISO ${String(photo.iso)}`,
    photo.focalLength === null ? null : `${String(photo.focalLength)}MM`,
  ];
  return parts.filter((part) => part !== null).join(' · ');
}

export function Lightbox({
  photo,
  onClose,
  onPrev,
  onNext,
  onToggleFavorite,
  inspectorOpen,
  onToggleInspector,
  onExport,
  onOffload,
  onRehydrateError,
  onDelete,
}: LightboxProps): ReactElement {
  const [chrome, setChrome] = useState(true);
  const [wokenFor, setWokenFor] = useState(photo.id);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Wake on photo change — a during-render adjustment, so the effect below
  // never sets state synchronously (react-hooks/set-state-in-effect).
  if (wokenFor !== photo.id) {
    setWokenFor(photo.id);
    setChrome(true);
  }

  const armTimer = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setChrome(false);
    }, CHROME_IDLE_MS);
  }, []);

  // Mousemove wakes the chrome and pushes the idle deadline out. Chromium
  // re-dispatches a synthetic mousemove when hit-testing changes under a
  // STATIONARY cursor (our own pointer-events flip on fade!) — ignore
  // events that didn't actually move, or the chrome can never hide while
  // the pointer rests on it.
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const wake = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const previous = lastPoint.current;
      lastPoint.current = { x: event.clientX, y: event.clientY };
      if (previous !== null && previous.x === event.clientX && previous.y === event.clientY) {
        return;
      }
      setChrome(true);
      armTimer();
    },
    [armTimer],
  );

  // (Re)arm the hide timer on mount and on every photo change.
  useEffect(() => {
    armTimer();
    return () => {
      clearTimeout(timer.current);
    };
  }, [armTimer, photo.id]);

  // Rehydrate on touch (#107): an offloaded photo downloads back on open;
  // failure surfaces as offloaded + red toast from the host — never a
  // half-restored record. The changed push flips syncState and the img
  // re-keys to retry the (previously 404) full-res URL. Refs keep this to
  // ONE request per photo — parent rerenders change the inline callback's
  // identity and refreshes can rerender before syncState lands (PR #205
  // review).
  const offloaded = photo.syncState === 'offloaded';
  const rehydrateErrorRef = useRef(onRehydrateError);
  useEffect(() => {
    rehydrateErrorRef.current = onRehydrateError;
  });
  const rehydrateRequestedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!offloaded || rehydrateRequestedFor.current === photo.id) {
      return;
    }
    rehydrateRequestedFor.current = photo.id;
    void window.overlook.backup.rehydrate({ photoId: photo.id }).catch(() => rehydrateErrorRef.current?.());
  }, [offloaded, photo.id]);

  const taken = photo.takenAt ?? photo.importedAt;
  const chromeClass = chrome ? ' ovl-lightbox__chrome--on' : '';

  return (
    <div
      className={`ovl-lightbox${inspectorOpen ? ' ovl-lightbox--docked' : ''}`}
      data-testid="lightbox"
      data-chrome={chrome ? 'on' : 'off'}
      onMouseMove={wake}
    >
      <img
        key={`${photo.id}-${photo.syncState}`}
        className="ovl-lightbox__img"
        src={fullUrl(photo.id)}
        alt={photo.fileName}
        data-orientation={photo.width >= photo.height ? 'landscape' : 'portrait'}
      />
      {photo.fileKind === 'raw' ? <span className="ovl-lightbox__preview mono-data">PREVIEW</span> : null}
      <div className={`ovl-lightbox__top ovl-lightbox__chrome${chromeClass}`}>
        <IconButton icon="arrow-left" label="Back to library (Esc)" onClick={onClose} />
        <span className="ovl-lightbox__title mono-data">
          {photo.fileName} — {taken.slice(0, 10)}
        </span>
        <IconButton icon="star" label="Favorite" active={photo.favorite} onClick={onToggleFavorite} />
        <IconButton icon="share" label="Export" onClick={onExport} />
        {photo.syncState === 'synced' && photo.deletedAt === null ? (
          <IconButton icon="cloud-upload" label="Offload original" onClick={onOffload} />
        ) : null}
        <IconButton icon="info" label="Inspector (I)" active={inspectorOpen} onClick={onToggleInspector} />
        {photo.deletedAt === null ? (
          // Already-deleted rows offer no Delete (PR #218 review) — the
          // trash pill's Restore is their action; purge is #121.
          <IconButton icon="trash-2" label="Delete" onClick={onDelete} />
        ) : null}
        {/* Explicit close at the conventional corner (#269) — the back arrow
            reads as navigation, not dismissal, and Esc is invisible. */}
        <IconButton icon="x" label="Close (Esc)" onClick={onClose} />
      </div>
      <div className={`ovl-lightbox__nav ovl-lightbox__chrome${chromeClass}`}>
        <IconButton icon="chevron-left" size="lg" label="Previous (←)" onClick={onPrev} />
        <IconButton icon="chevron-right" size="lg" label="Next (→)" onClick={onNext} />
      </div>
      <div className={`ovl-lightbox__strip ovl-lightbox__chrome${chromeClass}`}>
        <span className="mono-data">{exifStrip(photo)}</span>
      </div>
    </div>
  );
}
