import { useMemo } from 'react';
import type { ReactElement } from 'react';

import type { PhotoRecord } from '../../../shared/library/types.js';
import { Moodboard } from './Moodboard';
import { makeResolver, seedBoardFromPhotos } from './board-seed';

// Shell entry point for the Moodboard view (#693). Seeds one in-memory board
// from the visible library photos and resolves each placement's preview.
// Persistence + named boards land in a later slice; keeping the seed here keeps
// the Shell lean. The board re-seeds (remounts) only when the underlying photo
// set changes materially, so ordinary library pushes don't discard edits.
const LOCAL_BOARD_TITLE = 'Summer palette';

export interface MoodboardRouteProps {
  readonly photos: readonly PhotoRecord[];
  readonly onExport: (photoIds: readonly string[]) => void;
}

export function MoodboardRoute({ photos, onExport }: MoodboardRouteProps): ReactElement {
  const board = useMemo(() => seedBoardFromPhotos('board-local', LOCAL_BOARD_TITLE, photos), [photos]);
  const resolvePlacement = useMemo(() => makeResolver(photos), [photos]);
  const availablePhotoIds = useMemo(() => photos.filter((photo) => photo.deletedAt === null).map((photo) => photo.id), [photos]);
  const seedKey = board.placements.map((placement) => placement.photoId).join('|');
  return (
    <Moodboard key={seedKey} board={board} resolvePlacement={resolvePlacement} availablePhotoIds={availablePhotoIds} onExport={onExport} />
  );
}
