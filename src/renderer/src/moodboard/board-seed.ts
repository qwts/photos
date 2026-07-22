import type { Board, Placement } from '../../../shared/moodboard/board.js';
import { DEFAULT_BACKGROUND, DEFAULT_BOARD_SIZE, FULL_CROP } from '../../../shared/moodboard/board.js';
import type { PlacementAvailability } from '../../../shared/moodboard/availability.js';
import type { PhotoRecord } from '../../../shared/library/types.js';
import { thumbUrl } from '../../../shared/library/thumb-url.js';

// Renderer-side seed + photo resolution for the Moodboard (#693). Persistence
// lands in a later slice; for now a board is seeded in memory from the visible
// library photos, and each placement resolves its display name, preview source,
// and content availability at render time. Full-resolution bytes are never
// loaded here — the canvas draws from the bounded thumb derivative (decision 4).

/** Everything the canvas needs to render one placement without touching
 * originals. `thumbSrc` is null when no pixels may be shown. */
export interface PlacementView {
  readonly name: string;
  readonly thumbSrc: string | null;
  readonly availability: PlacementAvailability;
}

export type ResolvePlacement = (photoId: string) => PlacementView;

// Freeform starting spots (x, y, w, h) for a freshly seeded board.
const SEED_SPOTS: readonly (readonly [number, number, number, number])[] = [
  [90, 80, 260, 190],
  [420, 120, 210, 260],
  [700, 90, 250, 180],
  [300, 430, 230, 170],
  [620, 470, 210, 280],
  [900, 360, 200, 200],
  [110, 400, 150, 200],
];

export function availabilityOfPhoto(photo: PhotoRecord | undefined): PlacementAvailability {
  if (photo === undefined || photo.deletedAt !== null) return 'unavailable';
  return photo.syncState === 'offloaded' ? 'offloaded' : 'available';
}

/** Resolve a placement's view from the current library photos. Missing photos
 * (deleted or not in the active library) resolve to an honest unavailable
 * placeholder rather than a broken tile. */
export function makeResolver(photos: readonly PhotoRecord[]): ResolvePlacement {
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  return (photoId) => {
    const photo = byId.get(photoId);
    const availability = availabilityOfPhoto(photo);
    if (photo === undefined || availability === 'unavailable') {
      return { name: '', thumbSrc: null, availability: 'unavailable' };
    }
    const name = [photo.fileName, photo.place].filter((part) => part !== null && part !== '').join(', ');
    return { name, thumbSrc: thumbUrl(photo.id), availability };
  };
}

/** Seed an in-memory board from up to seven visible photos. */
export function seedBoardFromPhotos(boardId: string, title: string, photos: readonly PhotoRecord[]): Board {
  const pool = photos.filter((photo) => photo.deletedAt === null).slice(0, SEED_SPOTS.length);
  const placements: Placement[] = pool.map((photo, index) => {
    const spot = SEED_SPOTS[index] ?? SEED_SPOTS[0] ?? [0, 0, 200, 150];
    return {
      id: `pl-${index}`,
      photoId: photo.id,
      x: spot[0],
      y: spot[1],
      w: spot[2],
      h: spot[3],
      rotation: 0,
      crop: FULL_CROP,
      z: index + 1,
      groupId: null,
    };
  });
  return { id: boardId, title, notes: '', size: DEFAULT_BOARD_SIZE, background: DEFAULT_BACKGROUND, placements };
}
