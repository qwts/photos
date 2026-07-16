import type { DragEvent, ReactElement } from 'react';

import './phototile.css';
import { Icon } from './Icon';
import { StatusGlyph, type SyncState } from './StatusGlyph';

export interface PhotoTileProps {
  readonly src: string;
  readonly alt?: string;
  readonly selected?: boolean;
  readonly favorite?: boolean;
  readonly status?: SyncState;
  readonly showStatus?: boolean;
  /** Opens the photo (tile body). */
  readonly onClick?: () => void;
  /** Toggles selection (circle only) — never opens. */
  readonly onToggleSelect?: () => void;
  readonly onContextAction?: ((point: { readonly x: number; readonly y: number }) => void) | undefined;
  readonly onDragStart?: ((event: DragEvent<HTMLDivElement>) => void) | undefined;
  readonly onDragEnd?: (() => void) | undefined;
}

// media/PhotoTile.jsx — hover states ride CSS (:hover/:focus-within) instead
// of JS mouse tracking; the select circle is a real button (keyboard
// reachable) whose clicks never bubble into the open action.
export function PhotoTile({
  src,
  alt = '',
  selected = false,
  favorite = false,
  status = 'local',
  showStatus = true,
  onClick,
  onToggleSelect,
  onContextAction,
  onDragStart,
  onDragEnd,
}: PhotoTileProps): ReactElement {
  const classes = ['ovl-tile', selected ? 'ovl-tile--selected' : undefined, status === 'offloaded' ? 'ovl-tile--offloaded' : undefined]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={alt === '' ? 'Open photo' : `Open ${alt}`}
      className={classes}
      draggable={onDragStart !== undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextAction?.({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          onClick?.();
        }
      }}
    >
      <img src={src} alt={alt} loading="lazy" draggable={false} className="ovl-tile__img" />
      <div className="ovl-tile__hover-overlay" />
      <button
        type="button"
        aria-label={selected ? 'Deselect' : 'Select'}
        aria-pressed={selected}
        className={`ovl-tile__select${selected ? ' ovl-tile__select--selected' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggleSelect?.();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
      >
        {selected ? <Icon name="check" size={12} strokeWidth={3} /> : null}
      </button>
      {favorite ? (
        <span className="ovl-tile__star">
          <Icon name="star" size={13} strokeWidth={2} />
        </span>
      ) : null}
      {showStatus && status !== 'local' ? (
        <span className="ovl-tile__status">
          <StatusGlyph state={status} size={18} />
        </span>
      ) : null}
    </div>
  );
}
