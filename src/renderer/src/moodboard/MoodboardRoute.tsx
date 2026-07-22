import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import type { PhotoRecord } from '../../../shared/library/types.js';
import type { Board } from '../../../shared/moodboard/board.js';
import { Moodboard } from './Moodboard';
import { makeResolver, seedBoardFromPhotos } from './board-seed';

// Shell entry point for the Moodboard view (#515). Loads the persisted board
// from the encrypted library store (#694) and saves layout changes back
// (debounced), so the board survives restart and library switch — a library
// switch does a full renderer reload, which re-runs this load against the newly
// activated library.db (invariant I2). Seeds one board from the visible photos
// the first time the view is opened for a library.
const BOARD_ID = 'board-local';
const LOCAL_BOARD_TITLE = 'Summer palette';
const SAVE_DEBOUNCE_MS = 400;

export interface MoodboardRouteProps {
  readonly photos: readonly PhotoRecord[];
  readonly onExport: (photoIds: readonly string[]) => void;
}

export function MoodboardRoute({ photos, onExport }: MoodboardRouteProps): ReactElement | null {
  const [board, setBoard] = useState<Board | null>(null);
  const resolvePlacement = useMemo(() => makeResolver(photos), [photos]);
  const availablePhotoIds = useMemo(() => photos.filter((photo) => photo.deletedAt === null).map((photo) => photo.id), [photos]);
  // Captures the mount-time photos for the one-shot seed below.
  const photosRef = useRef(photos);
  const latestRef = useRef<Board | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void window.overlook.boards.get({ boardId: BOARD_ID }).then((result) => {
      if (cancelled) return;
      if (result.board !== null) {
        setBoard(result.board);
        return;
      }
      const seeded = seedBoardFromPhotos(BOARD_ID, LOCAL_BOARD_TITLE, photosRef.current);
      setBoard(seeded);
      void window.overlook.boards.save({ board: seeded });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Flush any pending save when the view unmounts (e.g. switching away).
  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current);
      if (latestRef.current !== null) void window.overlook.boards.save({ board: latestRef.current });
    };
  }, []);

  const onBoardChange = useCallback((next: Board) => {
    latestRef.current = next;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (latestRef.current !== null) void window.overlook.boards.save({ board: latestRef.current });
    }, SAVE_DEBOUNCE_MS);
  }, []);

  if (board === null) return null;

  return (
    <Moodboard
      board={board}
      resolvePlacement={resolvePlacement}
      availablePhotoIds={availablePhotoIds}
      onExport={onExport}
      onBoardChange={onBoardChange}
    />
  );
}
