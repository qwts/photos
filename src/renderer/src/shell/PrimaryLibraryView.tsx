import type { ComponentProps, ReactElement } from 'react';

import { LibraryGridView } from '../grid/LibraryGridView';
import { MoodboardRoute } from '../moodboard/MoodboardRoute';
import { useAppState } from '../state/app-state-context';

// The primary (non-protected) library content router (#693): the Moodboard
// canvas when the board view is active, otherwise the grid/list view. Keeps the
// Shell's content branch to a single element.
export function PrimaryLibraryView(props: ComponentProps<typeof LibraryGridView>): ReactElement {
  const state = useAppState();
  if (state.view === 'moodboard') {
    return <MoodboardRoute photos={state.photos} onExport={props.onExport} />;
  }
  return <LibraryGridView {...props} />;
}
