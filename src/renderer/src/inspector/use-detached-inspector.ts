import { useEffect, useMemo, useRef, type Dispatch } from 'react';

import type { AppAction, AppState } from '../../../shared/library/app-state.js';

export function useDetachedInspector(state: AppState, dispatch: Dispatch<AppAction>): readonly AppState['photos'][number][] {
  const wasDetachedRef = useRef(false);
  const selection = useMemo(() => state.photos.filter((photo) => state.selection.has(photo.id)), [state.photos, state.selection]);
  const windowState = useMemo(
    () => ({
      photoId: state.inspectorPhotoId,
      selectionPosition:
        state.inspectorSource === 'selection' && selection.length > 1
          ? {
              index: Math.max(
                0,
                selection.findIndex((photo) => photo.id === state.inspectorPhotoId),
              ),
              count: selection.length,
            }
          : null,
    }),
    [selection, state.inspectorPhotoId, state.inspectorSource],
  );

  useEffect(() => {
    if (state.inspectorDetached) {
      const operation = wasDetachedRef.current ? window.overlook.inspectorWindow.update : window.overlook.inspectorWindow.open;
      void operation(windowState);
    } else if (wasDetachedRef.current) {
      void window.overlook.inspectorWindow.close();
    }
    wasDetachedRef.current = state.inspectorDetached;
  }, [state.inspectorDetached, windowState]);

  useEffect(() => {
    const stopClosed = window.overlook.inspectorWindow.onClosed(() => dispatch({ type: 'inspector/detached-closed' }));
    const stopStep = window.overlook.inspectorWindow.onStepRequested((delta) => dispatch({ type: 'inspector/stepped', delta }));
    return () => {
      stopClosed();
      stopStep();
    };
  }, [dispatch]);

  return selection;
}
