import type { ChipFilters, PhotoRecord, SourceFilter } from './types.js';

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
  readonly selection: ReadonlySet<string>;
  readonly lightboxId: string | null;
  readonly inspectorOpen: boolean;
  readonly importOpen: boolean;
  readonly exportOpen: boolean;
  readonly settingsOpen: boolean;
  readonly toast: { readonly title: string; readonly tone: 'neutral' | 'green' | 'amber' | 'red' } | null;
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
  | { type: 'selection/toggled'; photoId: string }
  | { type: 'selection/all'; photoIds: readonly string[] }
  | { type: 'selection/cleared' }
  | { type: 'lightbox/opened'; photoId: string }
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
    case 'photos/loaded':
      return { ...state, photos: action.append ? [...state.photos, ...action.photos] : action.photos };
    case 'query/set':
      return { ...state, query: action.query };
    case 'zoom/set':
      return { ...state, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, action.zoom)) };
    case 'view/set':
      return { ...state, view: action.view };
    case 'source/set':
      // Changing source resets selection — the visible set changes wholesale.
      return { ...state, source: action.source, selection: new Set<string>() };
    case 'chip/toggled': {
      const next = { ...state.chips, [action.chip]: state.chips[action.chip] !== true };
      return { ...state, chips: next, selection: new Set<string>() };
    }
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
