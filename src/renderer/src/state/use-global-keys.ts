import { useEffect } from 'react';

import { useAppState, useAppDispatch } from './app-state-context';

// Global keyboard dispatcher scaffold (#73): routes by mode per the mock —
// ⌘/Ctrl+A selects all visible, Esc exits lightbox else clears selection,
// `i` toggles the inspector. Arrow navigation lands with the lightbox (M06).
export function useGlobalKeys(): void {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    const anyDialogOpen = state.importOpen || state.exportOpen || state.settingsOpen;
    const onKeyDown = (event: KeyboardEvent): void => {
      const inField = event.target instanceof HTMLElement && event.target.closest('input, textarea') !== null;
      if ((event.metaKey || event.ctrlKey) && event.key === 'a' && !inField && !anyDialogOpen) {
        event.preventDefault();
        dispatch({ type: 'selection/all', photoIds: state.photos.map((photo) => photo.id) });
        return;
      }
      if (event.key === 'Escape' && !anyDialogOpen) {
        dispatch({ type: 'escape' });
        return;
      }
      if (event.key === 'i' && !inField && !anyDialogOpen) {
        dispatch({ type: 'inspector/toggled' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [state.photos, state.importOpen, state.exportOpen, state.settingsOpen, dispatch]);
}
