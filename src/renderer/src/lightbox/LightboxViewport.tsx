import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, WheelEvent as ReactWheelEvent } from 'react';

import { fullUrl } from '../../../shared/library/full-url.js';
import type { PhotoRecord } from '../../../shared/library/types.js';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { clampTransform, fillZoom, fitSize, panBy, zoomAround, type LightboxSize, type LightboxTransform } from './geometry.js';

const FIT: LightboxTransform = { zoom: 1, x: 0, y: 0 };
const HINT_STORAGE_KEY = 'overlook.lightbox-gestures-seen';
const HINT_MS = 5500;
const KEYBOARD_ZOOM_STEP = 1.25;

interface LightboxViewportProps {
  readonly photo: PhotoRecord;
  readonly suppressRehydrate: boolean;
  readonly imageSrc?: string | undefined;
  readonly chromeClass: string;
  readonly onActivity: () => void;
}

function shouldShowHint(): boolean {
  try {
    return window.localStorage.getItem(HINT_STORAGE_KEY) !== '1';
  } catch {
    return true;
  }
}

function recordHint(): void {
  try {
    window.localStorage.setItem(HINT_STORAGE_KEY, '1');
  } catch {
    // A locked-down profile may reject localStorage; the hint still expires.
  }
}

function wheelPixels(value: number, mode: number, viewportAxis: number): number {
  if (mode === WheelEvent.DOM_DELTA_LINE) return value * 16;
  if (mode === WheelEvent.DOM_DELTA_PAGE) return value * viewportAxis;
  return value;
}

export function LightboxViewport({ photo, suppressRehydrate, imageSrc, chromeClass, onActivity }: LightboxViewportProps): ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<LightboxSize>({ width: 0, height: 0 });
  const [transform, setTransform] = useState<LightboxTransform>(FIT);
  const [mode, setMode] = useState<'fit' | 'fill' | 'custom'>('fit');
  const [showHint, setShowHint] = useState(shouldShowHint);
  const image = useMemo(() => ({ width: photo.width, height: photo.height }), [photo.height, photo.width]);
  const fitted = fitSize(image, viewport);

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      setViewport(next);
      setTransform((current) => clampTransform(current, fitSize(image, next), next));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [image]);

  useEffect(() => {
    if (!showHint) return;
    recordHint();
    const timer = window.setTimeout(() => {
      setShowHint(false);
    }, HINT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [showHint]);

  const reset = useCallback(() => {
    setTransform(FIT);
    setMode('fit');
    onActivity();
  }, [onActivity]);

  const zoomBy = useCallback(
    (factor: number) => {
      setTransform((current) =>
        zoomAround(current, current.zoom * factor, { x: viewport.width / 2, y: viewport.height / 2 }, fitted, viewport),
      );
      setMode('custom');
      setShowHint(false);
      onActivity();
    },
    [fitted, onActivity, viewport],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const inField = event.target instanceof HTMLElement && event.target.closest('input, textarea, select') !== null;
      const modalOpen = document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
      if (inField || modalOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomBy(KEYBOARD_ZOOM_STEP);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomBy(1 / KEYBOARD_ZOOM_STEP);
      } else if (event.key === '0') {
        event.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [reset, zoomBy]);

  const toggleFill = (): void => {
    if (mode === 'fill') {
      reset();
      return;
    }
    setTransform({ zoom: fillZoom(image, viewport), x: 0, y: 0 });
    setMode('fill');
    setShowHint(false);
    onActivity();
  };

  const onWheel = (event: ReactWheelEvent<HTMLImageElement>): void => {
    event.preventDefault();
    const deltaX = wheelPixels(event.deltaX, event.deltaMode, viewport.width);
    const deltaY = wheelPixels(event.deltaY, event.deltaMode, viewport.height);
    if (event.altKey) {
      const bounds = viewportRef.current?.getBoundingClientRect();
      const focal = {
        x: bounds === undefined ? viewport.width / 2 : event.clientX - bounds.left,
        y: bounds === undefined ? viewport.height / 2 : event.clientY - bounds.top,
      };
      setTransform((current) => zoomAround(current, current.zoom * Math.exp(-deltaY * 0.002), focal, fitted, viewport));
      setMode('custom');
      setShowHint(false);
    } else {
      setTransform((current) => panBy(current, { x: -deltaX, y: -deltaY }, fitted, viewport));
    }
    onActivity();
  };

  return (
    <div
      ref={viewportRef}
      className="ovl-lightbox__viewport"
      data-testid="lightbox-viewport"
      data-mode={mode}
      data-zoom={transform.zoom.toFixed(3)}
      data-pan-x={transform.x.toFixed(1)}
      data-pan-y={transform.y.toFixed(1)}
    >
      <img
        key={`${photo.id}-${suppressRehydrate ? 'synced' : photo.syncState}`}
        className="ovl-lightbox__img"
        src={imageSrc ?? fullUrl(photo.id)}
        alt={photo.fileName}
        data-orientation={photo.width >= photo.height ? 'landscape' : 'portrait'}
        draggable={false}
        style={{
          width: fitted.width,
          height: fitted.height,
          transform: `translate3d(${String(transform.x)}px, ${String(transform.y)}px, 0) scale(${String(transform.zoom)})`,
        }}
        onDoubleClick={toggleFill}
        onWheel={onWheel}
      />
      {showHint ? (
        <div className="ovl-lightbox__gesture-hint mono-data" role="status">
          DOUBLE-CLICK TO FILL · OPTION + SCROLL TO ZOOM · SCROLL TO PAN
        </div>
      ) : null}
      <div className={`ovl-lightbox__zoom ovl-lightbox__chrome${chromeClass}`} aria-label="Image zoom controls">
        <IconButton icon="minus" size="sm" label="Zoom out (−)" onClick={() => zoomBy(1 / KEYBOARD_ZOOM_STEP)} />
        <Button className="ovl-lightbox__zoom-reset mono-data" variant="ghost" size="sm" aria-label="Fit image (0)" onClick={reset}>
          {Math.round(transform.zoom * 100)}%
        </Button>
        <IconButton icon="plus" size="sm" label="Zoom in (+)" onClick={() => zoomBy(KEYBOARD_ZOOM_STEP)} />
      </div>
    </div>
  );
}
