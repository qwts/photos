import { useRef, useState } from 'react';
import type { DragEvent, ReactElement } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import type { AlbumSummary, PhotoRecord } from '../../../shared/library/types.js';
import { useFormats } from '../i18n/use-formats.js';
import { thumbUrl } from '../../../shared/library/thumb-url.js';
import { Icon } from '../components/Icon';
import { PhotoTile } from '../components/PhotoTile';
import { useAppState, useAppDispatch } from '../state/app-state-context';
import { useLibraryPhotos } from '../state/use-library-photos';
import { ListRow } from './ListRow';
import { PhotoContextMenu } from './PhotoContextMenu';
import { PurgeConfirm } from './PurgeConfirm';
import { SelectionPill } from './SelectionPill';
import { VirtualGrid } from './VirtualGrid';
import { beginPhotoDrag, endPhotoDrag } from './photo-drag-session';
import { PHOTO_PURGE_AUTHORIZATION } from '../../../shared/destructive-actions.js';
import { trashRetentionLabel } from '../../../shared/library/trash.js';

const messages = defineMessages({
  trashPolicy: {
    id: 'library.trash.retentionPolicy',
    defaultMessage: 'Items in Trash are deleted permanently after 30 days.',
  },
  purgedWithCloudRetry: {
    id: 'library.trash.purge.partial',
    defaultMessage: 'Deleted permanently: {purged} local; {remoteFailures} cloud pending retry',
  },
  purged: {
    id: 'library.trash.purge.complete',
    defaultMessage: 'Deleted {count, plural, one {# photo} other {# photos}} permanently',
  },
});

// Library view (#76/#77): PhotoTile or ListRow over the #74 engine, thumbs
// via the #75 protocol, empty state per the mock. Totals: sidebar counts
// size the plane for unfiltered sets; under query/chips the plane tracks the
// loaded count (+1 while pages remain) until an exact filtered count lands
// with #79.
export function LibraryGridView({
  knownTotal,
  activeAlbum,
  onOffload,
  onTransfer,
}: {
  readonly knownTotal: number | null;
  readonly activeAlbum: AlbumSummary | null;
  readonly onOffload: (photoIds: readonly string[], clearSelection?: boolean) => void;
  readonly onTransfer: (entry: 'selection' | 'lightbox', photoIds: readonly string[]) => void;
}): ReactElement {
  const intl = useIntl();
  const { formatCount } = useFormats();
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { loadMore, exhausted } = useLibraryPhotos();
  // Purge ceremony (#121): the Trash pill's permanent-delete action opens the confirm over
  // a SNAPSHOT of the selection — global shortcuts (⌘A) stay live while
  // the modal is open, and the destructive set must be exactly what the
  // user confirmed (PR #220 review).
  const [purgeIds, setPurgeIds] = useState<readonly string[] | null>(null);
  const [contextPhoto, setContextPhoto] = useState<{ readonly photo: PhotoRecord; readonly x: number; readonly y: number } | null>(null);
  const favoritePendingRef = useRef<ReadonlySet<string>>(new Set());
  const [favoritePending, setFavoritePending] = useState<ReadonlySet<string>>(() => new Set());
  const [retentionNow] = useState(() => Date.now());

  const toggleFavorite = (photo: PhotoRecord): void => {
    if (favoritePendingRef.current.has(photo.id)) return;
    const pending = new Set(favoritePendingRef.current);
    pending.add(photo.id);
    favoritePendingRef.current = pending;
    setFavoritePending(pending);
    void window.overlook.library
      .toggleFavorite({ id: photo.id })
      .then(({ pendingCount }) => {
        dispatch({ type: 'pendingCount/set', count: pendingCount });
      })
      .catch(() => {
        dispatch({ type: 'toast/shown', toast: { title: `COULDN'T UPDATE FAVORITE — ${photo.fileName}`, tone: 'red' } });
      })
      .finally(() => {
        const remaining = new Set(favoritePendingRef.current);
        remaining.delete(photo.id);
        favoritePendingRef.current = remaining;
        setFavoritePending(remaining);
      });
  };

  // An active album narrows like query/chips do (#117): the sidebar count
  // sized for the source no longer applies — track the loaded set instead.
  const filtersActive = state.query !== '' || state.album !== null || Object.values(state.chips).some(Boolean);
  const total = filtersActive || knownTotal === null ? (exhausted ? state.photos.length : state.photos.length + 1) : knownTotal;
  const inTrash = state.source === 'deleted';

  if (total === 0) {
    return (
      <>
        {inTrash ? <div className="ovl-trash-policy">{intl.formatMessage(messages.trashPolicy)}</div> : null}
        <div className={`ovl-empty${inTrash ? ' ovl-empty--inset' : ''}`} data-testid="empty-state">
          <Icon name="image-off" size={28} color="var(--text-faint)" />
          <div className="ovl-empty__title">Nothing matches</div>
          <div className="ovl-empty__hint">Try clearing search or filters.</div>
        </div>
      </>
    );
  }

  const renderTile = (photo: PhotoRecord): ReactElement => {
    const retentionLabel =
      state.source === 'deleted' && photo.deletedAt !== null ? trashRetentionLabel(photo.deletedAt, retentionNow) : undefined;
    const onDragStart =
      state.source === 'deleted'
        ? undefined
        : (event: DragEvent<HTMLButtonElement>): void => {
            beginPhotoDrag(event.dataTransfer, {
              version: 1,
              photoIds: state.selection.has(photo.id) ? [...state.selection] : [photo.id],
              sourceAlbumId: state.album,
            });
          };
    const onDragEnd = onDragStart === undefined ? undefined : endPhotoDrag;
    return state.view === 'list' ? (
      <ListRow
        photo={photo}
        selected={state.selection.has(photo.id)}
        onOpen={() => {
          dispatch({ type: 'lightbox/opened', photoId: photo.id });
        }}
        onToggleSelect={() => {
          dispatch({ type: 'selection/toggled', photoId: photo.id });
        }}
        onToggleFavorite={() => toggleFavorite(photo)}
        favoritePending={favoritePending.has(photo.id)}
        retentionLabel={retentionLabel}
        onContextAction={({ x, y }) => setContextPhoto({ photo, x, y })}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    ) : (
      <PhotoTile
        src={thumbUrl(photo.id)}
        alt={photo.fileName}
        favorite={photo.favorite}
        status={photo.syncState}
        previewFailure={photo.previewFailure}
        selected={state.selection.has(photo.id)}
        onClick={() => {
          dispatch({ type: 'lightbox/opened', photoId: photo.id });
        }}
        onToggleSelect={() => {
          dispatch({ type: 'selection/toggled', photoId: photo.id });
        }}
        onToggleFavorite={() => toggleFavorite(photo)}
        favoritePending={favoritePending.has(photo.id)}
        retentionLabel={retentionLabel}
        onContextAction={({ x, y }) => setContextPhoto({ photo, x, y })}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    );
  };

  return (
    <>
      {inTrash ? <div className="ovl-trash-policy">{intl.formatMessage(messages.trashPolicy)}</div> : null}
      <VirtualGrid
        photos={state.photos}
        total={total}
        zoom={state.zoom}
        mode={state.view}
        topInset={inTrash}
        onNeedMore={loadMore}
        renderTile={renderTile}
      />
      {state.selection.size > 0 ? (
        <SelectionPill
          count={state.selection.size}
          onClear={() => {
            dispatch({ type: 'selection/cleared' });
          }}
          onExport={() => {
            dispatch({ type: 'dialog/set', dialog: 'export', open: true });
          }}
          onOffload={() => onOffload([...state.selection], true)}
          onTransfer={() => onTransfer('selection', [...state.selection])}
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
                  setPurgeIds([...state.selection]);
                },
              }
            : {
                ...(state.album === null
                  ? {}
                  : {
                      onRemoveFromAlbum: () => {
                        const photoIds = [...state.selection];
                        const albumId = state.album;
                        if (albumId === null) return;
                        void window.overlook.albums.removePhotos({ albumId, photoIds }).then(({ removed }) => {
                          dispatch({
                            type: 'toast/shown',
                            toast: {
                              title: `Removed ${formatCount(removed)} ${removed === 1 ? 'photo' : 'photos'} from ${activeAlbum?.name ?? 'album'}`,
                              tone: 'neutral',
                            },
                          });
                        });
                      },
                    }),
                onDelete: () => {
                  const photoIds = [...state.selection];
                  void window.overlook.library.delete({ photoIds }).then(({ deleted }) => {
                    dispatch({
                      type: 'toast/shown',
                      toast: {
                        title: `Moved ${formatCount(deleted)} ${deleted === 1 ? 'photo' : 'photos'} to Trash`,
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
      {contextPhoto === null ? null : (
        <PhotoContextMenu
          photo={contextPhoto.photo}
          x={contextPhoto.x}
          y={contextPhoto.y}
          onClose={() => setContextPhoto(null)}
          onOffload={() => onOffload([contextPhoto.photo.id])}
          onTransfer={() => onTransfer('lightbox', [contextPhoto.photo.id])}
        />
      )}
      {purgeIds !== null && purgeIds.length > 0 ? (
        <PurgeConfirm
          count={purgeIds.length}
          onCancel={() => {
            setPurgeIds(null);
          }}
          onConfirm={() => {
            const photoIds = [...purgeIds];
            setPurgeIds(null);
            void window.overlook.library
              .purge({ photoIds, authorization: PHOTO_PURGE_AUTHORIZATION })
              .then(({ purged, remoteFailures }) => {
                dispatch({
                  type: 'toast/shown',
                  toast:
                    remoteFailures > 0
                      ? // Honest partial result: local copies are gone, some
                        // remote copies are orphaned (audited for retry).
                        {
                          title: intl.formatMessage(messages.purgedWithCloudRetry, {
                            purged: formatCount(purged),
                            remoteFailures: formatCount(remoteFailures),
                          }),
                          tone: 'amber',
                        }
                      : { title: intl.formatMessage(messages.purged, { count: purged }), tone: 'neutral' },
                });
              });
          }}
        />
      ) : null}
    </>
  );
}
