import type { ReactElement } from 'react';

import type { PhotoRecord } from '../../../shared/library/types.js';
import { thumbUrl } from '../../../shared/library/thumb-url.js';
import { Icon } from '../components/Icon';
import { PhotoTile } from '../components/PhotoTile';
import { useAppState, useAppDispatch } from '../state/app-state-context';
import { useLibraryPhotos } from '../state/use-library-photos';
import { ListRow } from './ListRow';
import { SelectionPill } from './SelectionPill';
import { VirtualGrid } from './VirtualGrid';

// Library view (#76/#77): PhotoTile or ListRow over the #74 engine, thumbs
// via the #75 protocol, empty state per the mock. Totals: sidebar counts
// size the plane for unfiltered sets; under query/chips the plane tracks the
// loaded count (+1 while pages remain) until an exact filtered count lands
// with #79.
export function LibraryGridView({ knownTotal }: { readonly knownTotal: number | null }): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { loadMore, exhausted } = useLibraryPhotos();

  const filtersActive = state.query !== '' || Object.values(state.chips).some(Boolean);
  const total = filtersActive || knownTotal === null ? (exhausted ? state.photos.length : state.photos.length + 1) : knownTotal;

  if (total === 0) {
    return (
      <div className="ovl-empty" data-testid="empty-state">
        <Icon name="image-off" size={28} color="var(--text-faint)" />
        <div className="ovl-empty__title">Nothing matches</div>
        <div className="ovl-empty__hint">Try clearing search or filters.</div>
      </div>
    );
  }

  const renderTile = (photo: PhotoRecord): ReactElement =>
    state.view === 'list' ? (
      <ListRow
        photo={photo}
        selected={state.selection.has(photo.id)}
        onOpen={() => {
          dispatch({ type: 'lightbox/opened', photoId: photo.id });
        }}
        onToggleSelect={() => {
          dispatch({ type: 'selection/toggled', photoId: photo.id });
        }}
      />
    ) : (
      <PhotoTile
        src={thumbUrl(photo.id)}
        alt={photo.fileName}
        favorite={photo.favorite}
        status={photo.syncState}
        selected={state.selection.has(photo.id)}
        onClick={() => {
          dispatch({ type: 'lightbox/opened', photoId: photo.id });
        }}
        onToggleSelect={() => {
          dispatch({ type: 'selection/toggled', photoId: photo.id });
        }}
      />
    );

  return (
    <>
      <VirtualGrid photos={state.photos} total={total} zoom={state.zoom} mode={state.view} onNeedMore={loadMore} renderTile={renderTile} />
      {state.selection.size > 0 ? (
        <SelectionPill
          count={state.selection.size}
          onClear={() => {
            dispatch({ type: 'selection/cleared' });
          }}
        />
      ) : null}
    </>
  );
}
