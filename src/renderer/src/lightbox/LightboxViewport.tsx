import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, SyntheticEvent, WheelEvent as ReactWheelEvent } from 'react';

import { fullUrl } from '../../../shared/library/full-url.js';
import type { PhotoRecord } from '../../../shared/library/types.js';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import {
  DEFAULT_ORIENTATION,
  clampTransform,
  fillZoom,
  fitSize,
  orientedSize,
  panBy,
  rotateOrientation,
  zoomAround,
  type LightboxOrientation,
  type LightboxSize,
  type LightboxTransform,
} from './geometry.js';

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
  readonly onDimensionsResolved: (width: number, height: number) => void;
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

export function LightboxViewport({
  photo,
  suppressRehydrate,
  imageSrc,
  chromeClass,
  onActivity,
  onDimensionsResolved,
}: LightboxViewportProps): ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<LightboxSize>({ width: 0, height: 0 });
  const [transform, setTransform] = useState<LightboxTransform>(FIT);
  const [orientation, setOrientation] = useState<LightboxOrientation>(DEFAULT_ORIENTATION);
  const [mode, setMode] = useState<'fit' | 'fill' | 'custom'>('fit');
  const [showHint, setShowHint] = useState(shouldShowHint);
  const [decoded, setDecoded] = useState<LightboxSize | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);
  const image = useMemo(() => decoded ?? { width: photo.width, height: photo.height }, [decoded, photo.height, photo.width]);
  const orientedImage = useMemo(() => orientedSize(image, orientation), [image, orientation]);
  const fitted = fitSize(orientedImage, viewport);
  const elementSize = orientedSize(fitted, orientation);
  const toolbarTop = Math.max(64, Math.min((viewport.height + fitted.height) / 2 - 8, viewport.height - 92));

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      setViewport(next);
      setTransform((current) => clampTransform(current, fitSize(orientedImage, next), next));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [orientedImage]);

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

  const resetView = useCallback(() => {
    setTransform(FIT);
    setMode('fit');
    onActivity();
  }, [onActivity]);

  const applyOrientation = useCallback(
    (next: LightboxOrientation) => {
      const axesChanged = next.quarterTurns % 2 !== orientation.quarterTurns % 2;
      const nextFitted = fitSize(orientedSize(image, next), viewport);
      setTransform((current) => clampTransform(current, nextFitted, viewport));
      if (axesChanged && mode === 'fill') setMode('custom');
      setOrientation(next);
      setShowHint(false);
      onActivity();
    },
    [image, mode, onActivity, orientation.quarterTurns, viewport],
  );

  const rotateBy = useCallback(
    (delta: -1 | 1) => {
      applyOrientation(rotateOrientation(orientation, delta));
    },
    [applyOrientation, orientation],
  );

  const flipHorizontal = useCallback(() => {
    applyOrientation({ ...orientation, flipped: !orientation.flipped });
  }, [applyOrientation, orientation]);

  const resetOrientation = useCallback(() => {
    applyOrientation(DEFAULT_ORIENTATION);
  }, [applyOrientation]);

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
        resetView();
      } else if (event.key === '[') {
        event.preventDefault();
        rotateBy(-1);
      } else if (event.key === ']') {
        event.preventDefault();
        rotateBy(1);
      } else if (event.key === '\\') {
        event.preventDefault();
        flipHorizontal();
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        resetOrientation();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [flipHorizontal, resetOrientation, resetView, rotateBy, zoomBy]);

  const toggleFill = (): void => {
    if (mode === 'fill') {
      resetView();
      return;
    }
    setTransform({ zoom: fillZoom(orientedImage, viewport), x: 0, y: 0 });
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

  const onImageLoad = (event: SyntheticEvent<HTMLImageElement>): void => {
    const width = event.currentTarget.naturalWidth;
    const height = event.currentTarget.naturalHeight;
    if (width <= 0 || height <= 0) return;
    setDecodeFailed(false);
    if (photo.width <= 0 || photo.height <= 0) {
      setDecoded({ width, height });
      onDimensionsResolved(width, height);
    }
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
      data-image-width={image.width}
      data-image-height={image.height}
      data-orientation-turns={orientation.quarterTurns}
      data-orientation-flipped={orientation.flipped ? 'true' : 'false'}
      data-unavailable={decodeFailed ? 'true' : 'false'}
    >
      <img
        key={`${photo.id}-${suppressRehydrate ? 'synced' : photo.syncState}`}
        className="ovl-lightbox__img"
        src={imageSrc ?? fullUrl(photo.id)}
        alt={photo.fileName}
        data-orientation={photo.width >= photo.height ? 'landscape' : 'portrait'}
        draggable={false}
        style={{
          width: elementSize.width,
          height: elementSize.height,
          transform: `translate3d(${String(transform.x)}px, ${String(transform.y)}px, 0) scale(${String(transform.zoom)}) scaleX(${orientation.flipped ? '-1' : '1'}) rotate(${String(orientation.quarterTurns * 90)}deg)`,
        }}
        onLoad={onImageLoad}
        onError={() => setDecodeFailed(true)}
        onDoubleClick={toggleFill}
        onWheel={onWheel}
      />
      {decodeFailed ? (
        <div className="ovl-lightbox__unavailable mono-data" role="status">
          PREVIEW UNAVAILABLE
        </div>
      ) : null}
      {showHint ? (
        <div className="ovl-lightbox__gesture-hint mono-data" role="status">
          DOUBLE-CLICK TO FILL · OPTION + SCROLL TO ZOOM · SCROLL TO PAN
        </div>
      ) : null}
      <div
        className={`ovl-lightbox__orientation ovl-lightbox__chrome${chromeClass}`}
        role="toolbar"
        aria-label="Image orientation controls"
        style={{ top: toolbarTop }}
      >
        <IconButton
          icon="refresh-cw"
          size="sm"
          label="Reset orientation (R)"
          aria-keyshortcuts="R"
          disabled={orientation.quarterTurns === 0 && !orientation.flipped}
          onClick={resetOrientation}
        />
        <IconButton
          icon="flip-horizontal-2"
          size="sm"
          label="Flip horizontal (Backslash)"
          aria-keyshortcuts="\\"
          active={orientation.flipped}
          onClick={flipHorizontal}
        />
        <span className="ovl-lightbox__orientation-divider" role="separator" aria-orientation="vertical" />
        <IconButton icon="rotate-ccw" size="sm" label="Rotate left ([)" aria-keyshortcuts="[" onClick={() => rotateBy(-1)} />
        <IconButton icon="rotate-cw" size="sm" label="Rotate right (])" aria-keyshortcuts="]" onClick={() => rotateBy(1)} />
      </div>
      <div className={`ovl-lightbox__zoom ovl-lightbox__chrome${chromeClass}`} aria-label="Image zoom controls" style={{ top: toolbarTop }}>
        <IconButton icon="minus" size="sm" label="Zoom out (−)" onClick={() => zoomBy(1 / KEYBOARD_ZOOM_STEP)} />
        <Button className="ovl-lightbox__zoom-reset mono-data" variant="ghost" size="sm" aria-label="Fit image (0)" onClick={resetView}>
          {Math.round(transform.zoom * 100)}%
        </Button>
        <IconButton icon="plus" size="sm" label="Zoom in (+)" onClick={() => zoomBy(KEYBOARD_ZOOM_STEP)} />
      </div>
    </div>
  );
}
