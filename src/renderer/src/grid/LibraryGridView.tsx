import { useState } from 'react';
import type { ReactElement } from 'react';

import type { PhotoRecord } from '../../../shared/library/types.js';
import { formatCount } from '../../../shared/library/format.js';
import { thumbUrl } from '../../../shared/library/thumb-url.js';
import { Icon } from '../components/Icon';
import { PhotoTile } from '../components/PhotoTile';
import { useAppState, useAppDispatch } from '../state/app-state-context';
import { useLibraryPhotos } from '../state/use-library-photos';
import { ListRow } from './ListRow';
import { PurgeConfirm } from './PurgeConfirm';
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
  // Purge ceremony (#121): the trash pill's Delete opens the confirm.
  const [purgeConfirm, setPurgeConfirm] = useState(false);

  // An active album narrows like query/chips do (#117): the sidebar count
  // sized for the source no longer applies — track the loaded set instead.
  const filtersActive = state.query !== '' || state.album !== null || Object.values(state.chips).some(Boolean);
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
          onExport={() => {
            dispatch({ type: 'dialog/set', dialog: 'export', open: true });
          }}
          // Soft delete / restore (#120): the visible page refreshes off
          // the change push; the reducer intersects the selection away.
          {...(state.source === 'deleted'
            ? {
                onRestore: () => {
                  const photoIds = [...state.selection];
                  void window.overlook.library.restore({ photoIds }).then(({ restored }) => {
                    dispatch({
                      type: 'toast/shown',
                      toast: { title: `Restored ${formatCount(restored)} ${restored === 1 ? 'photo' : 'photos'}`, tone: 'green' },
                    });
                  });
                },
                onPurge: () => {
                  setPurgeConfirm(true);
                },
              }
            : {
                onDelete: () => {
                  const photoIds = [...state.selection];
                  void window.overlook.library.delete({ photoIds }).then(({ deleted }) => {
                    dispatch({
                      type: 'toast/shown',
                      toast: {
                        title: `Moved ${formatCount(deleted)} ${deleted === 1 ? 'photo' : 'photos'} to Recently deleted`,
                        tone: 'neutral',
                      },
                    });
                  });
                },
                // Add to album (#118): exact counts in the mock's voice —
                // "Added 12 photos to Big Sur". The sidebar count rides
                // the change push.
                onAddToAlbum: (album) => {
                  const photoIds = [...state.selection];
                  void window.overlook.albums.addPhotos({ albumId: album.id, photoIds }).then(({ added }) => {
                    dispatch({
                      type: 'toast/shown',
                      toast: { title: `Added ${formatCount(added)} ${added === 1 ? 'photo' : 'photos'} to ${album.name}`, tone: 'green' },
                    });
                  });
                },
              })}
        />
      ) : null}
      {purgeConfirm && state.selection.size > 0 ? (
        <PurgeConfirm
          count={state.selection.size}
          onCancel={() => {
            setPurgeConfirm(false);
          }}
          onConfirm={() => {
            const photoIds = [...state.selection];
            setPurgeConfirm(false);
            void window.overlook.library.purge({ photoIds }).then(({ purged, remoteFailures }) => {
              dispatch({
                type: 'toast/shown',
                toast:
                  remoteFailures > 0
                    ? // Honest partial result: local copies are gone, some
                      // remote copies are orphaned (audited for retry).
                      { title: `Deleted ${formatCount(purged)} — ${formatCount(remoteFailures)} CLOUD COPIES PENDING`, tone: 'amber' }
                    : { title: `Deleted ${formatCount(purged)} ${purged === 1 ? 'photo' : 'photos'}`, tone: 'neutral' },
              });
            });
          }}
        />
      ) : null}
    </>
  );
}
