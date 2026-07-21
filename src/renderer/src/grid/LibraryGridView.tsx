import { useEffect, useRef, useState } from 'react';
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
import { AlbumPicker } from './AlbumPicker';
import { PurgeConfirm } from './PurgeConfirm';
import { SelectionPill } from './SelectionPill';
import { VirtualGrid, type VirtualGridItemKeyboard } from './VirtualGrid';
import { beginPhotoDrag, endPhotoDrag } from './photo-drag-session';
import { PHOTO_PURGE_AUTHORIZATION } from '../../../shared/destructive-actions.js';
import { DEFAULT_TRASH_RETENTION, trashRetentionDays, trashRetentionLabel, type TrashRetention } from '../../../shared/library/trash.js';
import { useAnnouncer } from '../components/LiveAnnouncer';

const messages = defineMessages({
  trashPolicyDays: {
    id: 'library.trash.retentionPolicy.days',
    defaultMessage: 'Items in Trash are deleted permanently after {days} days.',
  },
  trashPolicyOff: {
    id: 'library.trash.retentionPolicy.off',
    defaultMessage: 'Items in Trash are kept until you delete them permanently.',
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
  const { formatCalendarDate, formatCount } = useFormats();
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { announce } = useAnnouncer();
  const { loadMore, exhausted } = useLibraryPhotos();
  // Purge ceremony (#121): the Trash pill's permanent-delete action opens the confirm over
  // a SNAPSHOT of the selection — global shortcuts (⌘A) stay live while
  // the modal is open, and the destructive set must be exactly what the
  // user confirmed (PR #220 review).
  const [purgeIds, setPurgeIds] = useState<readonly string[] | null>(null);
  const [contextPhoto, setContextPhoto] = useState<{
    readonly photo: PhotoRecord;
    readonly targetIds: readonly string[];
    readonly x: number;
    readonly y: number;
    readonly origin: HTMLButtonElement;
  } | null>(null);
  const [albumPicker, setAlbumPicker] = useState<{
    readonly targetIds: readonly string[];
    readonly x: number;
    readonly y: number;
    readonly origin: HTMLButtonElement;
  } | null>(null);
  const favoritePendingRef = useRef<ReadonlySet<string>>(new Set());
  const [favoritePending, setFavoritePending] = useState<ReadonlySet<string>>(() => new Set());
  const [retentionNow] = useState(() => Date.now());
  const [trashRetention, setTrashRetention] = useState<TrashRetention>(DEFAULT_TRASH_RETENTION);

  useEffect(() => {
    let active = true;
    let changed = false;
    const unsubscribe = window.overlook.settings.onChanged(({ settings }) => {
      changed = true;
      setTrashRetention(settings.trashRetention);
    });
    void window.overlook.settings.get().then(({ settings }) => {
      if (active && !changed) setTrashRetention(settings.trashRetention);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

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
        dispatch({ type: 'toast/shown', toast: { title: `Couldn't update favorite — ${photo.fileName}`, tone: 'red' } });
      })
      .finally(() => {
        const remaining = new Set(favoritePendingRef.current);
        remaining.delete(photo.id);
        favoritePendingRef.current = remaining;
        setFavoritePending(remaining);
      });
  };

  const openContextMenu = (
    photo: PhotoRecord,
    point: { readonly x: number; readonly y: number; readonly origin: HTMLButtonElement },
  ): void => {
    const targetIds = state.selection.has(photo.id) ? [...state.selection] : [photo.id];
    if (!state.selection.has(photo.id)) dispatch({ type: 'selection/all', photoIds: targetIds });
    setContextPhoto({ photo, targetIds, ...point });
  };

  const restoreContextFocus = (origin: HTMLButtonElement): void => {
    requestAnimationFrame(() => {
      if (origin.isConnected) origin.focus();
    });
  };

  // An active album narrows like query/chips do (#117): the sidebar count
  // sized for the source no longer applies — track the loaded set instead.
  const filtersActive = state.query !== '' || state.album !== null || Object.values(state.chips).some(Boolean);
  const total = filtersActive || knownTotal === null ? (exhausted ? state.photos.length : state.photos.length + 1) : knownTotal;
  const inTrash = state.source === 'deleted';
  const retentionDays = trashRetentionDays(trashRetention);
  const trashPolicy = intl.formatMessage(retentionDays === null ? messages.trashPolicyOff : messages.trashPolicyDays, {
    days: retentionDays,
  });

  useEffect(() => {
    if (total === 0) announce('Nothing matches. Try clearing search or filters.', 'polite', 'empty-state');
  }, [announce, total]);

  if (total === 0) {
    return (
      <>
        {inTrash ? <div className="ovl-trash-policy">{trashPolicy}</div> : null}
        <div className={`ovl-empty${inTrash ? ' ovl-empty--inset' : ''}`} data-testid="empty-state">
          <Icon name="image-off" size={28} color="var(--text-faint)" />
          <div className="ovl-empty__title">Nothing matches</div>
          <div className="ovl-empty__hint">Try clearing search or filters.</div>
        </div>
      </>
    );
  }

  const renderTile = (photo: PhotoRecord, _size: number, keyboard: VirtualGridItemKeyboard): ReactElement => {
    const accessibleName = `Open ${[photo.fileName, formatCalendarDate(photo.takenAt ?? photo.importedAt), photo.place].filter((part) => part !== null).join(', ')}`;
    const retentionLabel =
      state.source === 'deleted' && photo.deletedAt !== null
        ? trashRetentionLabel(photo.deletedAt, trashRetention, retentionNow)
        : undefined;
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
        accessibleName={accessibleName}
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
        onContextAction={(point) => openContextMenu(photo, point)}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        {...keyboard}
      />
    ) : (
      <PhotoTile
        src={thumbUrl(photo.id)}
        alt={photo.fileName}
        accessibleName={accessibleName}
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
        onContextAction={(point) => openContextMenu(photo, point)}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        {...keyboard}
      />
    );
  };

  return (
    <>
      {inTrash ? <div className="ovl-trash-policy">{trashPolicy}</div> : null}
      <VirtualGrid
        photos={state.photos}
        total={total}
        zoom={state.zoom}
        mode={state.view}
        topInset={inTrash}
        onNeedMore={loadMore}
        renderTile={renderTile}
        onKeyboardOpen={(photo) => dispatch({ type: 'lightbox/opened', photoId: photo.id })}
        onKeyboardSelection={(photoIds, mode) => {
          if (mode === 'replace') dispatch({ type: 'selection/all', photoIds });
          else if (photoIds[0] !== undefined) dispatch({ type: 'selection/toggled', photoId: photoIds[0] });
        }}
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
          targetCount={contextPhoto.targetIds.length}
          inAlbum={state.album !== null}
          x={contextPhoto.x}
          y={contextPhoto.y}
          onClose={() => {
            setContextPhoto(null);
            restoreContextFocus(contextPhoto.origin);
          }}
          onOpen={() => dispatch({ type: 'lightbox/opened', photoId: contextPhoto.photo.id })}
          onToggleFavorite={() => {
            const targetIds = new Set(contextPhoto.targetIds);
            for (const photo of state.photos.filter(({ id }) => targetIds.has(id))) toggleFavorite(photo);
          }}
          onExport={() => {
            dispatch({ type: 'selection/all', photoIds: contextPhoto.targetIds });
            dispatch({ type: 'dialog/set', dialog: 'export', open: true });
          }}
          onAddToAlbum={() => {
            setAlbumPicker({ targetIds: contextPhoto.targetIds, x: contextPhoto.x, y: contextPhoto.y, origin: contextPhoto.origin });
          }}
          onRemoveFromAlbum={() => {
            const albumId = state.album;
            if (albumId === null) return;
            void window.overlook.albums.removePhotos({ albumId, photoIds: [...contextPhoto.targetIds] }).then(({ removed }) => {
              dispatch({
                type: 'toast/shown',
                toast: {
                  title: `Removed ${formatCount(removed)} ${removed === 1 ? 'photo' : 'photos'} from ${activeAlbum?.name ?? 'album'}`,
                  tone: 'neutral',
                },
              });
            });
          }}
          onOffload={() => onOffload(contextPhoto.targetIds)}
          onRestoreOriginal={() => {
            void window.overlook.backup.restoreOriginals({ photoIds: [...contextPhoto.targetIds] }).then(({ restored, failed }) => {
              dispatch({
                type: 'toast/shown',
                toast: {
                  title:
                    failed === 0
                      ? `Restored ${formatCount(restored)} ${restored === 1 ? 'original' : 'originals'}`
                      : `Restored ${formatCount(restored)} · ${formatCount(failed)} failed`,
                  tone: failed === 0 ? 'green' : 'red',
                },
              });
            });
          }}
          onTransfer={() => onTransfer(contextPhoto.targetIds.length === 1 ? 'lightbox' : 'selection', contextPhoto.targetIds)}
          onTrash={() => {
            void window.overlook.library.delete({ photoIds: [...contextPhoto.targetIds] }).then(({ deleted }) => {
              dispatch({
                type: 'toast/shown',
                toast: { title: `Moved ${formatCount(deleted)} ${deleted === 1 ? 'photo' : 'photos'} to Trash`, tone: 'neutral' },
              });
            });
          }}
          onRestore={() => {
            void window.overlook.library.restore({ photoIds: [...contextPhoto.targetIds] }).then(({ restored }) => {
              dispatch({
                type: 'toast/shown',
                toast: { title: `Restored ${formatCount(restored)} ${restored === 1 ? 'photo' : 'photos'}`, tone: 'green' },
              });
            });
          }}
          onPurge={() => setPurgeIds(contextPhoto.targetIds)}
        />
      )}
      {albumPicker === null ? null : (
        <AlbumPicker
          position={{ x: albumPicker.x, y: albumPicker.y }}
          onClose={() => {
            setAlbumPicker(null);
            restoreContextFocus(albumPicker.origin);
          }}
          onPick={(album) => {
            const targetIds = albumPicker.targetIds;
            setAlbumPicker(null);
            void window.overlook.albums.addPhotos({ albumId: album.id, photoIds: [...targetIds] }).then(({ added }) => {
              dispatch({
                type: 'toast/shown',
                toast: { title: `Added ${formatCount(added)} ${added === 1 ? 'photo' : 'photos'} to ${album.name}`, tone: 'green' },
              });
              restoreContextFocus(albumPicker.origin);
            });
          }}
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
