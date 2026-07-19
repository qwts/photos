import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEventHandler, PointerEventHandler, RefObject } from 'react';

const CHROME_IDLE_MS = 2200;
const CLICK_MOVE_TOLERANCE_PX = 6;

interface ChromeVisibility {
  readonly chrome: boolean;
  readonly rootRef: RefObject<HTMLDivElement>;
  readonly armTimer: () => void;
  readonly hideChrome: () => void;
  readonly wakeChrome: () => void;
}

interface ChromeGestures {
  readonly startClickGesture: PointerEventHandler<HTMLDivElement>;
  readonly trackClickGesture: PointerEventHandler<HTMLDivElement>;
  readonly cancelClickGesture: () => void;
  readonly hideForImageClick: MouseEventHandler<HTMLDivElement>;
}

function useChromeVisibility(photoId: string): ChromeVisibility {
  const [chrome, setChrome] = useState(true);
  const [wokenFor, setWokenFor] = useState(photoId);
  const rootRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  if (wokenFor !== photoId) {
    setWokenFor(photoId);
    setChrome(true);
  }

  const armTimer = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && rootRef.current?.contains(active) === true) return;
      setChrome(false);
    }, CHROME_IDLE_MS);
  }, []);

  const hideChrome = useCallback(() => {
    clearTimeout(timerRef.current);
    const active = document.activeElement;
    if (active instanceof HTMLElement && rootRef.current?.contains(active) === true) active.blur();
    setChrome(false);
  }, []);

  const wakeChrome = useCallback(() => {
    setChrome(true);
    armTimer();
  }, [armTimer]);

  useEffect(() => {
    armTimer();
    return () => clearTimeout(timerRef.current);
  }, [armTimer, photoId]);

  useEffect(() => {
    const wakeFromWindow = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target) === true) return;
      wakeChrome();
    };
    window.addEventListener('keydown', wakeFromWindow);
    return () => window.removeEventListener('keydown', wakeFromWindow);
  }, [wakeChrome]);

  return { chrome, rootRef, armTimer, hideChrome, wakeChrome };
}

function useChromeGestures(wakeChrome: () => void, hideChrome: () => void): ChromeGestures {
  const clickGestureRef = useRef<{
    readonly pointerId: number;
    readonly x: number;
    readonly y: number;
    moved: boolean;
  } | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const startClickGesture: PointerEventHandler<HTMLDivElement> = useCallback((event) => {
    clickGestureRef.current =
      event.isPrimary && event.button === 0 ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false } : null;
  }, []);

  const trackClickGesture: PointerEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      const previous = lastPointRef.current;
      lastPointRef.current = { x: event.clientX, y: event.clientY };
      if (previous === null || previous.x !== event.clientX || previous.y !== event.clientY) wakeChrome();
      const gesture = clickGestureRef.current;
      if (gesture === null || gesture.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > CLICK_MOVE_TOLERANCE_PX) gesture.moved = true;
    },
    [wakeChrome],
  );

  const cancelClickGesture = useCallback(() => {
    clickGestureRef.current = null;
  }, []);

  const hideForImageClick: MouseEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      const gesture = clickGestureRef.current;
      cancelClickGesture();
      const target = event.target;
      if (event.detail !== 1 || gesture?.moved === true || !(target instanceof Element)) return;
      if (target.closest('.ovl-lightbox__chrome, button, [role="button"]') !== null) return;
      hideChrome();
    },
    [cancelClickGesture, hideChrome],
  );

  return { startClickGesture, trackClickGesture, cancelClickGesture, hideForImageClick };
}

export function useLightboxChrome(photoId: string): ChromeVisibility & ChromeGestures {
  const visibility = useChromeVisibility(photoId);
  const gestures = useChromeGestures(visibility.wakeChrome, visibility.hideChrome);
  return { ...visibility, ...gestures };
}
