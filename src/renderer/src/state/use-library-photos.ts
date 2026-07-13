import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChipFilters, PageCursor, PageRequest } from '../../../shared/library/types.js';
import { useAppState, useAppDispatch } from './app-state-context';

const PAGE_SIZE = 500; // channel max — fewest round-trips on deep scrolls

export const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function recentSinceIso(): string {
  return new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
}

function chipsActive(chips: ChipFilters): boolean {
  return Object.values(chips).some(Boolean);
}

// Data windowing for the grid engine (#74): first page per visible set
// (source + query + chips, #76), cursor pages on demand. Stale-cancel: any
// visible-set change bumps the request id, so a late response from the
// previous set is dropped instead of appended. `exhausted` tells the grid
// the loaded count IS the filtered total (counts can't answer for filters).
export function useLibraryPhotos(): { readonly loadMore: () => void; readonly exhausted: boolean } {
  const { source, query, chips, sortOrder } = useAppState();
  const dispatch = useAppDispatch();
  const cursorRef = useRef<PageCursor | null>(null);
  const requestRef = useRef(0);
  const inFlightRef = useRef(false);
  // Exhaustion is keyed to the visible set: switching sets changes the key,
  // which resets `exhausted` derivationally (no setState-in-effect).
  const setKey = `${source}|${query}|${JSON.stringify(chips)}|${sortOrder}`;
  const [exhaustedKey, setExhaustedKey] = useState<string | null>(null);
  const exhausted = exhaustedKey === setKey;

  const baseRequest = useCallback(
    (): Omit<PageRequest, 'cursor'> => ({
      source,
      limit: PAGE_SIZE,
      ...(source === 'recent' ? { recentSince: recentSinceIso() } : {}),
      ...(query === '' ? {} : { query }),
      ...(chipsActive(chips) ? { chips } : {}),
      ...(sortOrder === 'date' ? {} : { order: sortOrder }),
    }),
    [source, query, chips, sortOrder],
  );

  const fetchFirstPage = useCallback(() => {
    const requestId = (requestRef.current += 1);
    inFlightRef.current = true;
    cursorRef.current = null;
    void window.overlook.library
      .page(baseRequest())
      .then(({ photos, nextCursor }) => {
        if (requestRef.current !== requestId) {
          return;
        }
        cursorRef.current = nextCursor;
        setExhaustedKey(nextCursor === null ? setKey : null);
        dispatch({ type: 'photos/loaded', photos, append: false });
      })
      .finally(() => {
        if (requestRef.current === requestId) {
          inFlightRef.current = false;
        }
      });
  }, [baseRequest, setKey, dispatch]);

  useEffect(() => {
    fetchFirstPage();
  }, [fetchFirstPage]);

  // Library mutations refetch the visible page too (PR #167 review): a
  // favorite toggle while viewing Favorites must add/remove the row, not
  // leave stale cells or permanent loading placeholders. Replace semantics
  // reset the cursor; the selection intersects safely in the reducer.
  useEffect(() => {
    return window.overlook.library.onChanged(() => {
      fetchFirstPage();
    });
  }, [fetchFirstPage]);

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (inFlightRef.current || cursor === null) {
      return;
    }
    const requestId = requestRef.current;
    inFlightRef.current = true;
    void window.overlook.library
      .page({ ...baseRequest(), cursor })
      .then(({ photos, nextCursor }) => {
        if (requestRef.current !== requestId) {
          return;
        }
        cursorRef.current = nextCursor;
        setExhaustedKey(nextCursor === null ? setKey : null);
        dispatch({ type: 'photos/loaded', photos, append: true });
      })
      .finally(() => {
        if (requestRef.current === requestId) {
          inFlightRef.current = false;
        }
      });
  }, [baseRequest, setKey, dispatch]);

  return { loadMore, exhausted };
}
