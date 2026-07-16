import { useEffect, useRef, type ReactElement } from 'react';

import type { AlbumSummary } from '../../../shared/library/types.js';
import { Icon } from '../components/Icon';

export interface AlbumActionMenuProps {
  readonly album: AlbumSummary;
  readonly x: number;
  readonly y: number;
  readonly onRename: () => void;
  readonly onDelete: () => void;
  readonly onTransfer: () => void;
  readonly onClose: () => void;
}

export function AlbumActionMenu({ album, x, y, onRename, onDelete, onTransfer, onClose }: AlbumActionMenuProps): ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const close = (): void => onClose();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${album.name}`}
      className="ovl-album-menu"
      style={{ left: Math.max(8, Math.min(x, window.innerWidth - 210)), top: Math.max(8, Math.min(y, window.innerHeight - 128)) }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const target =
          event.key === 'Home'
            ? items[0]
            : event.key === 'End'
              ? items.at(-1)
              : event.key === 'ArrowDown'
                ? items[(current + 1) % items.length]
                : items[(current - 1 + items.length) % items.length];
        target?.focus();
      }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onRename();
        }}
      >
        <Icon name="album" size={14} />
        Rename album…
      </button>
      <button
        type="button"
        role="menuitem"
        className="ovl-album-menu__danger"
        onClick={() => {
          onDelete();
        }}
      >
        <Icon name="trash-2" size={14} />
        Delete album…
      </button>
      <button type="button" role="menuitem" onClick={onTransfer}>
        <Icon name="refresh-cw" size={14} />
        Transfer &amp; Sync…
      </button>
    </div>
  );
}
