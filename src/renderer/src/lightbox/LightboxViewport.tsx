import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, SyntheticEvent, WheelEvent as ReactWheelEvent } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { COMMANDS, formatAriaShortcut, formatShortcut, resolveCommand, type CommandId } from '../../../shared/commands/registry.js';
import { commandPlatform } from '../state/use-command-dispatcher';

import type { PhotoRecord } from '../../../shared/library/types.js';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { previewFailureLabel } from '../components/previewFailureLabel';
import {
  DEFAULT_ORIENTATION,
  DEFAULT_VIEW_INTENT,
  clampTransform,
  fillZoom,
  flipVerticalOrientation,
  fitSize,
  orientedSize,
  panBy,
  rotateOrientation,
  transformToViewIntent,
  viewIntentToTransform,
  zoomAround,
  type LightboxOrientation,
  type LightboxSize,
  type LightboxViewIntent,
  type LightboxZoomMode,
} from './geometry.js';

const HINT_STORAGE_KEY = 'overlook.lightbox-gestures-seen';
const HINT_MS = 5500;
const KEYBOARD_ZOOM_STEP = 1.25;
const KEYBOARD_PAN_STEP = 64;
const LOADING_INDICATOR_DELAY_MS = 180;

const messages = defineMessages({
  loading: {
    id: 'lightbox.image.loading',
    defaultMessage: 'Loading full-resolution image…',
  },
});

type ImageLoadStage = 'loading' | 'decoded' | 'error';

interface LightboxViewportProps {
  readonly platform: string;
  readonly requestKey: string;
  readonly photo: PhotoRecord;
  readonly viewIntent: LightboxViewIntent;
  readonly onViewIntentChange: (intent: LightboxViewIntent) => void;
  readonly imageSrc: string;
  readonly chromeVisible: boolean;
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
  platform,
  requestKey,
  photo,
  viewIntent,
  onViewIntentChange,
  imageSrc,
  chromeVisible,
  onActivity,
  onDimensionsResolved,
}: LightboxViewportProps): ReactElement {
  const intl = useIntl();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<LightboxSize>({ width: 0, height: 0 });
  const [orientation, setOrientation] = useState<LightboxOrientation>(DEFAULT_ORIENTATION);
  const [showHint, setShowHint] = useState(shouldShowHint);
  const [decoded, setDecoded] = useState<LightboxSize | null>(null);
  const source = imageSrc;
  const [loadStage, setLoadStage] = useState<ImageLoadStage>('loading');
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);
  const image = useMemo(() => decoded ?? { width: photo.width, height: photo.height }, [decoded, photo.height, photo.width]);
  const orientedImage = useMemo(() => orientedSize(image, orientation), [image, orientation]);
  const fitted = fitSize(orientedImage, viewport);
  const transform = viewIntentToTransform(viewIntent, orientedImage, viewport);
  const mode = viewIntent.mode;
  const elementSize = orientedSize(fitted, orientation);
  const toolbarTop = Math.max(64, Math.min((viewport.height + fitted.height) / 2 - 8, viewport.height - 92));
  const chromeClass = chromeVisible ? ' ovl-lightbox__chrome--on' : '';

  useEffect(() => {
    if (loadStage !== 'loading') return;
    const timer = window.setTimeout(() => {
      setShowLoadingIndicator(true);
    }, LOADING_INDICATOR_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadStage]);

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      setViewport(next);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

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
    onViewIntentChange(DEFAULT_VIEW_INTENT);
    onActivity();
  }, [onActivity, onViewIntentChange]);

  const applyOrientation = useCallback(
    (next: LightboxOrientation) => {
      const axesChanged = next.quarterTurns % 2 !== orientation.quarterTurns % 2;
      const nextFitted = fitSize(orientedSize(image, next), viewport);
      const nextMode: LightboxZoomMode = axesChanged && mode === 'fill' ? 'custom' : mode;
      onViewIntentChange(transformToViewIntent(clampTransform(transform, nextFitted, viewport), nextMode, nextFitted, viewport));
      setOrientation(next);
      setShowHint(false);
      onActivity();
    },
    [image, mode, onActivity, onViewIntentChange, orientation.quarterTurns, transform, viewport],
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

  const flipVertical = useCallback(() => {
    applyOrientation(flipVerticalOrientation(orientation));
  }, [applyOrientation, orientation]);

  const resetOrientation = useCallback(() => {
    applyOrientation(DEFAULT_ORIENTATION);
  }, [applyOrientation]);

  const zoomBy = useCallback(
    (factor: number) => {
      const next = zoomAround(transform, transform.zoom * factor, { x: viewport.width / 2, y: viewport.height / 2 }, fitted, viewport);
      onViewIntentChange(transformToViewIntent(next, 'custom', fitted, viewport));
      setShowHint(false);
      onActivity();
    },
    [fitted, onActivity, onViewIntentChange, transform, viewport],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const inField =
        event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]') !== null;
      const modalOpen = document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
      if (inField || modalOpen || event.metaKey || event.ctrlKey) return;
      const horizontalOverflow = fitted.width * transform.zoom > viewport.width + 1;
      const verticalOverflow = fitted.height * transform.zoom > viewport.height + 1;
      const panDelta =
        !event.altKey && !event.shiftKey && event.key === 'ArrowLeft' && horizontalOverflow
          ? { x: KEYBOARD_PAN_STEP, y: 0 }
          : event.key === 'ArrowRight' && horizontalOverflow
            ? { x: -KEYBOARD_PAN_STEP, y: 0 }
            : event.key === 'ArrowUp' && verticalOverflow
              ? { x: 0, y: KEYBOARD_PAN_STEP }
              : event.key === 'ArrowDown' && verticalOverflow
                ? { x: 0, y: -KEYBOARD_PAN_STEP }
                : null;
      if (panDelta !== null) {
        event.preventDefault();
        const next = panBy(transform, panDelta, fitted, viewport);
        onViewIntentChange(transformToViewIntent(next, mode, fitted, viewport));
        setShowHint(false);
        onActivity();
        return;
      }
      const command = resolveCommand(event, {
        surface: 'lightbox',
        dialogOpen: modalOpen,
        editable: inField,
        platform: commandPlatform(platform),
      });
      if (command?.id === 'view.lightbox.zoomIn') zoomBy(KEYBOARD_ZOOM_STEP);
      else if (command?.id === 'view.lightbox.zoomOut') zoomBy(1 / KEYBOARD_ZOOM_STEP);
      else if (command?.id === 'view.lightbox.zoomReset') resetView();
      else if (command?.id === 'view.lightbox.rotateLeft') rotateBy(-1);
      else if (command?.id === 'view.lightbox.rotateRight') rotateBy(1);
      else if (command?.id === 'view.lightbox.flipHorizontal') flipHorizontal();
      else if (command?.id === 'view.lightbox.flipVertical') flipVertical();
      else if (command?.id === 'view.lightbox.orientationReset') resetOrientation();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [
    fitted,
    flipHorizontal,
    flipVertical,
    mode,
    onActivity,
    onViewIntentChange,
    platform,
    resetOrientation,
    resetView,
    rotateBy,
    transform,
    viewport,
    zoomBy,
  ]);

  const toggleFill = (): void => {
    if (mode === 'fill') {
      resetView();
      return;
    }
    onViewIntentChange({ mode: 'fill', zoom: fillZoom(orientedImage, viewport), panX: 0, panY: 0 });
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
      const next = zoomAround(transform, transform.zoom * Math.exp(-deltaY * 0.002), focal, fitted, viewport);
      onViewIntentChange(transformToViewIntent(next, 'custom', fitted, viewport));
      setShowHint(false);
    } else {
      const next = panBy(transform, { x: -deltaX, y: -deltaY }, fitted, viewport);
      onViewIntentChange(transformToViewIntent(next, mode, fitted, viewport));
    }
    onActivity();
  };

  useEffect(() => {
    if (loadStage === 'error') onViewIntentChange(DEFAULT_VIEW_INTENT);
  }, [loadStage, onViewIntentChange]);

  const onImageLoad = (event: SyntheticEvent<HTMLImageElement>): void => {
    const element = event.currentTarget;
    void element
      .decode()
      .then(() => {
        if (!element.isConnected) return;
        const width = element.naturalWidth;
        const height = element.naturalHeight;
        if (width <= 0 || height <= 0) {
          setLoadStage('error');
          return;
        }
        if (photo.width <= 0 || photo.height <= 0) {
          setDecoded({ width, height });
          onDimensionsResolved(width, height);
        }
        setLoadStage('decoded');
      })
      .catch(() => {
        if (element.isConnected) setLoadStage('error');
      });
  };

  const shortcutLabel = (id: CommandId): string => {
    const command = COMMANDS.find((candidate) => candidate.id === id);
    if (command === undefined) return id;
    return `${intl.formatMessage(command.label)} (${formatShortcut(command, commandPlatform(platform))})`;
  };

  const ariaShortcut = (id: CommandId): string | undefined => {
    const command = COMMANDS.find((candidate) => candidate.id === id);
    return command === undefined ? undefined : formatAriaShortcut(command, commandPlatform(platform));
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
      data-load-state={loadStage}
      data-unavailable={loadStage === 'error' ? 'true' : 'false'}
      aria-busy={loadStage === 'loading'}
    >
      {/* The rule fires on this <img> because of `onDoubleClick` (and the onLoad/onError
          lifecycle handlers), not `onWheel`, which is in no jsx-a11y handler set. Keyboard
          pan is provided by the viewport-level Arrow key handler; this disable acknowledges
          only that the image legitimately carries pointer and lifecycle handlers. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <img
        key={requestKey}
        className={`ovl-lightbox__img${loadStage === 'decoded' ? ' ovl-lightbox__img--decoded' : ''}`}
        src={source}
        alt={photo.fileName}
        data-request-key={requestKey}
        data-orientation={photo.width >= photo.height ? 'landscape' : 'portrait'}
        draggable={false}
        style={{
          width: elementSize.width,
          height: elementSize.height,
          transform: `translate3d(${String(transform.x)}px, ${String(transform.y)}px, 0) scale(${String(transform.zoom)}) scaleX(${orientation.flipped ? '-1' : '1'}) rotate(${String(orientation.quarterTurns * 90)}deg)`,
        }}
        onLoad={onImageLoad}
        onError={() => setLoadStage('error')}
        onDoubleClick={toggleFill}
        onWheel={onWheel}
      />
      {loadStage === 'loading' && showLoadingIndicator ? (
        <div className="ovl-lightbox__loading mono-data" role="status" aria-live="polite">
          <span className="ovl-lightbox__loading-spinner" aria-hidden="true" />
          {intl.formatMessage(messages.loading)}
        </div>
      ) : null}
      {loadStage === 'error' ? (
        <div className="ovl-lightbox__unavailable mono-data" role="status">
          {previewFailureLabel(intl, photo.previewFailure)}
        </div>
      ) : null}
      {showHint && chromeVisible ? (
        <div className="ovl-lightbox__gesture-hint mono-data" role="status">
          DOUBLE-CLICK TO FILL · OPTION + SCROLL TO ZOOM · SCROLL OR ARROWS TO PAN
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
          size="md"
          label={shortcutLabel('view.lightbox.orientationReset')}
          aria-keyshortcuts={ariaShortcut('view.lightbox.orientationReset')}
          onClick={resetOrientation}
        />
        <IconButton
          icon="flip-horizontal-2"
          size="md"
          label={shortcutLabel('view.lightbox.flipHorizontal')}
          aria-keyshortcuts={ariaShortcut('view.lightbox.flipHorizontal')}
          onClick={flipHorizontal}
        />
        <IconButton
          icon="flip-horizontal-2"
          size="md"
          className="ovl-lightbox__flip-vertical"
          label={shortcutLabel('view.lightbox.flipVertical')}
          aria-keyshortcuts={ariaShortcut('view.lightbox.flipVertical')}
          onClick={flipVertical}
        />
        <span className="ovl-lightbox__orientation-divider" role="separator" aria-orientation="vertical" />
        <IconButton
          icon="rotate-ccw"
          size="md"
          label={shortcutLabel('view.lightbox.rotateLeft')}
          aria-keyshortcuts={ariaShortcut('view.lightbox.rotateLeft')}
          onClick={() => rotateBy(-1)}
        />
        <IconButton
          icon="rotate-cw"
          size="md"
          label={shortcutLabel('view.lightbox.rotateRight')}
          aria-keyshortcuts={ariaShortcut('view.lightbox.rotateRight')}
          onClick={() => rotateBy(1)}
        />
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
