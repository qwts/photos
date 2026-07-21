import { Fragment, type DragEvent, type KeyboardEvent, type ReactElement } from 'react';
import { useIntl } from 'react-intl';

import './phototile.css';
import type { PreviewFailureReason } from '../../../shared/library/preview.js';
import { FavoriteButton } from './FavoriteButton';
import { Icon } from './Icon';
import { PhotoOpenButton } from './PhotoOpenButton';
import { previewFailureLabel } from './previewFailureLabel';
import { StatusGlyph, type SyncState } from './StatusGlyph';

export interface PhotoTileProps {
  readonly src: string;
  readonly alt?: string;
  /** Full screen-reader label when filename-only `alt` lacks date/place context. */
  readonly accessibleName?: string | undefined;
  readonly selected?: boolean;
  readonly favorite?: boolean;
  readonly status?: SyncState;
  readonly showStatus?: boolean;
  readonly previewFailure?: PreviewFailureReason | null;
  readonly retentionLabel?: string | undefined;
  /** Opens the photo (tile body). */
  readonly onClick?: () => void;
  /** Toggles selection (circle only) — never opens. */
  readonly onToggleSelect?: () => void;
  /** Toggles Favorite (star only) — never opens or selects. */
  readonly onToggleFavorite?: () => void;
  readonly favoritePending?: boolean;
  readonly onContextAction?: ((point: { readonly x: number; readonly y: number; readonly origin: HTMLButtonElement }) => void) | undefined;
  readonly onDragStart?: ((event: DragEvent<HTMLButtonElement>) => void) | undefined;
  readonly onDragEnd?: (() => void) | undefined;
  readonly tabIndex?: 0 | -1 | undefined;
  readonly gridFocusTarget?: true | undefined;
  readonly onFocus?: (() => void) | undefined;
  readonly onKeyDown?: ((event: KeyboardEvent<HTMLButtonElement>) => void) | undefined;
}

function setPreviewUnavailable(image: HTMLImageElement, unavailable: boolean, label: string): void {
  image.dataset['unavailable'] = unavailable ? 'true' : 'false';
  const fallback = image.nextElementSibling;
  if (!(fallback instanceof HTMLElement)) return;
  fallback.textContent = unavailable ? label : '';
  if (unavailable) fallback.setAttribute('role', 'status');
  else fallback.removeAttribute('role');
}

// media/PhotoTile.jsx — hover states ride CSS (:hover/:focus-within) instead
// of JS mouse tracking. Open and select are sibling buttons so both keep their
// native semantics in the accessibility tree.
export function PhotoTile({
  src,
  alt = '',
  accessibleName,
  selected = false,
  favorite = false,
  status = 'local',
  showStatus = true,
  previewFailure,
  retentionLabel,
  onClick,
  onToggleSelect,
  onToggleFavorite,
  favoritePending = false,
  onContextAction,
  onDragStart,
  onDragEnd,
  tabIndex,
  gridFocusTarget,
  onFocus,
  onKeyDown,
}: PhotoTileProps): ReactElement {
  const intl = useIntl();
  const unavailableLabel = previewFailureLabel(intl, previewFailure);
  const photoName = (accessibleName ?? (alt === '' ? 'photo' : alt)).replace(/^Open /u, '');
  const classes = ['ovl-tile', selected ? 'ovl-tile--selected' : undefined, status === 'offloaded' ? 'ovl-tile--offloaded' : undefined]
    .filter(Boolean)
    .join(' ');
  return (
    <div role="group" className={classes}>
      <PhotoOpenButton
        label={accessibleName ?? (alt === '' ? 'Open photo' : `Open ${alt}`)}
        className="ovl-tile__open"
        onOpen={onClick}
        onContextAction={onContextAction}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        tabIndex={tabIndex}
        gridFocusTarget={gridFocusTarget}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      />
      <Fragment key={`${src}:${previewFailure ?? ''}`}>
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          className="ovl-tile__img"
          data-unavailable="false"
          onLoad={(event) => {
            setPreviewUnavailable(event.currentTarget, false, unavailableLabel);
          }}
          onError={(event) => {
            setPreviewUnavailable(event.currentTarget, true, unavailableLabel);
          }}
        />
        <div className="ovl-tile__unavailable mono-data" />
      </Fragment>
      <div className="ovl-tile__hover-overlay" />
      {onToggleSelect === undefined ? null : (
        <button
          type="button"
          aria-label={`${selected ? 'Deselect' : 'Select'} ${photoName}`}
          aria-pressed={selected}
          className={`ovl-tile__select${selected ? ' ovl-tile__select--selected' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelect();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
          }}
        >
          {selected ? <Icon name="check" size={12} strokeWidth={3} /> : null}
        </button>
      )}
      {onToggleFavorite === undefined ? null : (
        <FavoriteButton favorite={favorite} pending={favoritePending} className="ovl-tile__favorite" onToggle={onToggleFavorite} />
      )}
      {showStatus && status !== 'local' ? (
        <span className="ovl-tile__status">
          <StatusGlyph state={status} size={18} />
        </span>
      ) : null}
      {retentionLabel === undefined ? null : <span className="ovl-tile__retention mono-data">{retentionLabel}</span>}
    </div>
  );
}
