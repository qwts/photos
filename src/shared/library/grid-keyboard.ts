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
  const { key, count, columns, pageRows, direction } = move;
  if (count <= 0 || columns <= 0) return 0;
  const index = Math.min(count - 1, Math.max(0, move.index));
  const rowStart = Math.floor(index / columns) * columns;
  const rowEnd = Math.min(count - 1, rowStart + columns - 1);
  switch (key) {
    case 'ArrowLeft':
      return direction === 'rtl' ? Math.min(rowEnd, index + 1) : Math.max(rowStart, index - 1);
    case 'ArrowRight':
      return direction === 'rtl' ? Math.max(rowStart, index - 1) : Math.min(rowEnd, index + 1);
    case 'ArrowUp':
      return index - columns < 0 ? index : index - columns;
    case 'ArrowDown':
      return index + columns >= count ? index : index + columns;
    case 'Home':
      return rowStart;
    case 'End':
      return rowEnd;
    case 'PageUp':
      return Math.max(0, index - columns * Math.max(1, pageRows));
    case 'PageDown':
      return Math.min(count - 1, index + columns * Math.max(1, pageRows));
  }
}
