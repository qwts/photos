import type { Dispatch } from 'react';

import type { AppAction } from '../../../shared/library/app-state.js';

export function deletePhoto(photoId: string, dispatch: Dispatch<AppAction>): void {
  void window.overlook.library.delete({ photoIds: [photoId] }).then(({ protected: protectedCount }) => {
    dispatch({
      type: 'toast/shown',
      toast: {
        title: protectedCount === 0 ? 'Moved 1 photo to Trash' : 'Preserved 1 protected Original',
        tone: protectedCount === 0 ? 'neutral' : 'amber',
      },
    });
  });
}
