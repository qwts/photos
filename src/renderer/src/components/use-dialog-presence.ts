import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const EXIT_DURATION_MS = 200;

interface DialogPresence {
  readonly rendered: boolean;
  readonly closing: boolean;
  readonly requestClose: () => void;
}

function reducedMotionRequested(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function useDialogPresence(open: boolean, onClose: (() => void) | undefined, panelRef: RefObject<HTMLDivElement>): DialogPresence {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  const focusOriginRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const restoreFocus = useCallback((): void => {
    const origin = focusOriginRef.current;
    focusOriginRef.current = null;
    window.setTimeout(() => {
      if (origin?.isConnected === true) origin.focus();
    });
  }, []);

  const finishClose = useCallback((): void => {
    timerRef.current = null;
    closingRef.current = false;
    setClosing(false);
    onCloseRef.current?.();
    restoreFocus();
  }, [restoreFocus]);

  const startClose = useCallback((): void => {
    if (onCloseRef.current === undefined || closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const delay = reducedMotionRequested() ? 0 : EXIT_DURATION_MS;
    timerRef.current = window.setTimeout(finishClose, delay);
  }, [finishClose]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const active = document.activeElement;
    if (focusOriginRef.current === null && active instanceof HTMLElement && panel?.contains(active) !== true) {
      focusOriginRef.current = active;
    }
    if (panel !== null && !panel.contains(active)) panel.focus();
  }, [open, panelRef]);

  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    if (closing) panel.setAttribute('inert', '');
    else panel.removeAttribute('inert');
    return () => {
      panel.removeAttribute('inert');
    };
  }, [closing, panelRef]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const requestClose = useCallback((): void => startClose(), [startClose]);

  return { rendered: open || closing, closing, requestClose };
}
