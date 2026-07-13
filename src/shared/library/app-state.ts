import type { ChipFilters, PhotoRecord, SortOrder, SourceFilter } from './types.js';

// App state backbone (#73) — the mock's state shape as a pure reducer, kept
// process-free so the unit lane floors it. The renderer provides it via
// context; IPC push events dispatch into it.

export type ViewMode = 'grid' | 'list';

export const ZOOM_MIN = 96;
export const ZOOM_MAX = 320;
export const ZOOM_DEFAULT = 160;

export interface AppState {
  readonly photos: readonly PhotoRecord[];
  readonly query: string;
  readonly zoom: number;
  readonly view: ViewMode;
  readonly source: SourceFilter;
  readonly chips: ChipFilters;
  /** Mirrors the settings store's sortOrder (#113); the grid query reads it. */
  readonly sortOrder: SortOrder;
  readonly selection: ReadonlySet<string>;
  readonly lightboxId: string | null;
  readonly inspectorOpen: boolean;
  readonly importOpen: boolean;
  readonly exportOpen: boolean;
  readonly settingsOpen: boolean;
  readonly toast: {
    readonly title: string;
    readonly tone: 'neutral' | 'green' | 'amber' | 'red';
    /** Serializable action marker — the shell maps it to a handler (#89). */
    readonly action?: 'show-recent' | 'retry-backup' | undefined;
  } | null;
  readonly pendingCount: number;
  readonly lastBackupLabel: string;
}

export const initialAppState: AppState = {
  photos: [],
  query: '',
  zoom: ZOOM_DEFAULT,
  view: 'grid',
  source: 'all',
  chips: {},
  sortOrder: 'date',
  selection: new Set<string>(),
  lightboxId: null,
  inspectorOpen: false,
  importOpen: false,
  exportOpen: false,
  settingsOpen: false,
  toast: null,
  pendingCount: 0,
  lastBackupLabel: '2H AGO',
};

export type AppAction =
  | { type: 'photos/loaded'; photos: readonly PhotoRecord[]; append: boolean }
  | { type: 'query/set'; query: string }
  | { type: 'zoom/set'; zoom: number }
  | { type: 'view/set'; view: ViewMode }
  | { type: 'source/set'; source: SourceFilter }
  | { type: 'chip/toggled'; chip: keyof ChipFilters }
  | { type: 'sortOrder/set'; order: SortOrder }
  | { type: 'selection/toggled'; photoId: string }
  | { type: 'selection/all'; photoIds: readonly string[] }
  | { type: 'selection/cleared' }
  | { type: 'lightbox/opened'; photoId: string }
  | { type: 'lightbox/stepped'; delta: 1 | -1 }
  | { type: 'lightbox/closed' }
  | { type: 'inspector/toggled' }
  | { type: 'dialog/set'; dialog: 'import' | 'export' | 'settings'; open: boolean }
  | { type: 'toast/shown'; toast: NonNullable<AppState['toast']> }
  | { type: 'toast/dismissed' }
  | { type: 'pendingCount/set'; count: number }
  | { type: 'backupLabel/set'; label: string }
  | { type: 'escape' };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'photos/loaded': {
      if (action.append) {
        return { ...state, photos: [...state.photos, ...action.photos] };
      }
      // Mock semantics (#78): selection survives filter/source changes only
      // for still-visible items — intersect with each fresh first page. The
      // lightbox follows the same rule (#92, PR #187 review): a photo that
      // left the visible set closes it for real, never lingering to reopen.
      const visible = new Set(action.photos.map((photo) => photo.id));
      const selection = new Set([...state.selection].filter((id) => visible.has(id)));
      const lightboxId = state.lightboxId !== null && visible.has(state.lightboxId) ? state.lightboxId : null;
      return { ...state, photos: action.photos, selection, lightboxId };
    }
    case 'query/set':
      return { ...state, query: action.query };
    case 'zoom/set':
      return { ...state, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, action.zoom)) };
    case 'view/set':
      return { ...state, view: action.view };
    case 'source/set':
      // Selection is NOT cleared here: the next photos/loaded intersects it
      // with the new visible set (still-visible items survive, #78).
      return { ...state, source: action.source };
    case 'chip/toggled': {
      const next = { ...state.chips, [action.chip]: state.chips[action.chip] !== true };
      return { ...state, chips: next };
    }
    case 'sortOrder/set':
      // Fed by settings:changed pushes (#113) — the query hook refetches
      // and the next photos/loaded intersects the selection as usual.
      return { ...state, sortOrder: action.order };
    case 'selection/toggled': {
      const selection = new Set(state.selection);
      if (selection.has(action.photoId)) {
        selection.delete(action.photoId);
      } else {
        selection.add(action.photoId);
      }
      return { ...state, selection };
    }
    case 'selection/all':
      return { ...state, selection: new Set(action.photoIds) };
    case 'selection/cleared':
      return { ...state, selection: new Set<string>() };
    case 'lightbox/opened':
      return { ...state, lightboxId: action.photoId };
    case 'lightbox/stepped': {
      // ←/→ step the VISIBLE (filtered) sequence with wraparound (#93);
      // a closed lightbox or an empty page is a no-op.
      if (state.lightboxId === null || state.photos.length === 0) {
        return state;
      }
      const index = state.photos.findIndex((photo) => photo.id === state.lightboxId);
      if (index === -1) {
        return state;
      }
      const next = state.photos[(index + action.delta + state.photos.length) % state.photos.length];
      return next === undefined ? state : { ...state, lightboxId: next.id };
    }
    case 'lightbox/closed':
      return { ...state, lightboxId: null };
    case 'inspector/toggled':
      return { ...state, inspectorOpen: !state.inspectorOpen };
    case 'dialog/set':
      return {
        ...state,
        importOpen: action.dialog === 'import' ? action.open : state.importOpen,
        exportOpen: action.dialog === 'export' ? action.open : state.exportOpen,
        settingsOpen: action.dialog === 'settings' ? action.open : state.settingsOpen,
      };
    case 'toast/shown':
      return { ...state, toast: action.toast };
    case 'toast/dismissed':
      return { ...state, toast: null };
    case 'pendingCount/set':
      return { ...state, pendingCount: action.count };
    case 'backupLabel/set':
      return { ...state, lastBackupLabel: action.label };
    case 'escape':
      // Mock semantics: Esc exits the lightbox when open, otherwise clears
      // the selection.
      if (state.lightboxId !== null) {
        return { ...state, lightboxId: null };
      }
      return { ...state, selection: new Set<string>() };
  }
}
