import { useEffect, useRef, useState, type ReactElement } from 'react';

import './pill.css';
import { formatCount } from '../../../shared/library/format.js';
import { Icon } from '../components/Icon';
import type { AlbumSummary } from '../../../shared/library/types.js';

export interface AlbumPickerProps {
  /** Picked an existing album (or one just created inline). */
  readonly onPick: (album: AlbumSummary) => void;
  readonly onClose: () => void;
}

// Add-to-album picker (#118): a popover anchored above the selection pill —
// existing albums (live counts) + inline create, keyboard-first (Escape
// closes; the create row works like the sidebar's, Enter commits).
export function AlbumPicker({ onPick, onClose }: AlbumPickerProps): ReactElement {
  const [albums, setAlbums] = useState<readonly AlbumSummary[] | null>(null);

  useEffect(() => {
    void window.overlook.library.albums().then(({ albums: loaded }) => {
      setAlbums(loaded);
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  // Keyboard flow (PR #219 review): the popover renders BEFORE its trigger
  // in DOM order, so focus must move INTO it on open — the first album row
  // when any exist, else the create input. Only after the async albums
  // load settles (albums !== null), and once — refocusing later renders
  // would steal the caret.
  const rootRef = useRef<HTMLDivElement>(null);
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (albums === null || focusedOnce.current) {
      return;
    }
    const first = rootRef.current?.querySelector<HTMLElement>('[role="menuitem"], input');
    if (first !== null && first !== undefined) {
      focusedOnce.current = true;
      first.focus();
    }
  }, [albums]);

  return (
    <div ref={rootRef} className="ovl-albumpicker" data-testid="album-picker" role="menu" aria-label="Add to album">
      {(albums ?? []).map((album) => (
        <button
          key={album.id}
          type="button"
          role="menuitem"
          className="ovl-albumpicker__row"
          onClick={() => {
            onPick(album);
          }}
        >
          <Icon name="album" size={14} color="var(--text-faint)" />
          <span className="ovl-albumpicker__name">{album.name}</span>
          <span className="ovl-albumpicker__count mono-data">{formatCount(album.count)}</span>
        </button>
      ))}
      <input
        className="ovl-albumpicker__create"
        aria-label="New album name"
        placeholder="New album…"
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            const name = event.currentTarget.value.trim();
            if (name !== '') {
              void window.overlook.albums.create({ name }).then(({ album }) => {
                onPick(album);
              });
            }
          }
        }}
      />
    </div>
  );
}
