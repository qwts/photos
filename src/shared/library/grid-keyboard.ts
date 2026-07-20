export type GridNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown';

export interface GridFocusMove {
  readonly key: GridNavigationKey;
  readonly index: number;
  readonly count: number;
  readonly columns: number;
  readonly pageRows: number;
  readonly direction: 'ltr' | 'rtl';
}

export function moveGridFocus(move: GridFocusMove): number {
  return move.index;
}
