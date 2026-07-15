import { useEffect, useRef, type ReactElement } from 'react';

import type { PhotoRecord } from '../../../shared/library/types.js';
import { Icon } from '../components/Icon';

import './context-menu.css';

export interface PhotoContextMenuProps {
  readonly photo: PhotoRecord;
  readonly x: number;
  readonly y: number;
  readonly onOffload: () => void;
  readonly onClose: () => void;
}

export function PhotoContextMenu({ photo, x, y, onOffload, onClose }: PhotoContextMenuProps): ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menuRef.current?.focus();
    const close = (): void => onClose();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${photo.fileName}`}
      tabIndex={-1}
      className="ovl-context-menu"
      style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 60) }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onOffload();
        }}
      >
        <Icon name="cloud-upload" size={14} />
        Offload original…
      </button>
    </div>
  );
}
