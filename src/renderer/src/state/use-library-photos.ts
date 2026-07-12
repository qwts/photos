import { useCallback, useEffect, useRef } from 'react';

import type { PageCursor } from '../../../shared/library/types.js';
import { useAppState, useAppDispatch } from './app-state-context';

const PAGE_SIZE = 500; // channel max — fewest round-trips on deep scrolls

export const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function recentSinceIso(): string {
  return new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
}

// Data windowing for the grid engine (#74): first page per source, cursor
// pages on demand. Stale-cancel: a source switch bumps the request id, so a
// late response from the previous source is dropped instead of appended.
export function useLibraryPhotos(): { readonly loadMore: () => void } {
  const { source } = useAppState();
  const dispatch = useAppDispatch();
  const cursorRef = useRef<PageCursor | null>(null);
  const requestRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    const requestId = (requestRef.current += 1);
    inFlightRef.current = true;
    cursorRef.current = null;
    void window.overlook.library
      .page({ source, limit: PAGE_SIZE, ...(source === 'recent' ? { recentSince: recentSinceIso() } : {}) })
      .then(({ photos, nextCursor }) => {
        if (requestRef.current !== requestId) {
          return;
        }
        cursorRef.current = nextCursor;
        dispatch({ type: 'photos/loaded', photos, append: false });
      })
      .finally(() => {
        if (requestRef.current === requestId) {
          inFlightRef.current = false;
        }
      });
  }, [source, dispatch]);

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (inFlightRef.current || cursor === null) {
      return;
    }
    const requestId = requestRef.current;
    inFlightRef.current = true;
    void window.overlook.library
      .page({ source, limit: PAGE_SIZE, cursor, ...(source === 'recent' ? { recentSince: recentSinceIso() } : {}) })
      .then(({ photos, nextCursor }) => {
        if (requestRef.current !== requestId) {
          return;
        }
        cursorRef.current = nextCursor;
        dispatch({ type: 'photos/loaded', photos, append: true });
      })
      .finally(() => {
        if (requestRef.current === requestId) {
          inFlightRef.current = false;
        }
      });
  }, [source, dispatch]);

  return { loadMore };
}
