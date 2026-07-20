import { Fragment, type DragEvent, type ReactElement } from 'react';
import { useIntl } from 'react-intl';

import './phototile.css';
import type { PreviewFailureReason } from '../../../shared/library/preview.js';
import { Icon } from './Icon';
import { PhotoOpenButton } from './PhotoOpenButton';
import { previewFailureLabel } from './previewFailureLabel';
import { StatusGlyph, type SyncState } from './StatusGlyph';

export interface PhotoTileProps {
  readonly src: string;
  readonly alt?: string;
  readonly selected?: boolean;
  readonly favorite?: boolean;
  readonly status?: SyncState;
  readonly showStatus?: boolean;
  readonly previewFailure?: PreviewFailureReason | null;
  /** Opens the photo (tile body). */
  readonly onClick?: () => void;
  /** Toggles selection (circle only) — never opens. */
  readonly onToggleSelect?: () => void;
  readonly onContextAction?: ((point: { readonly x: number; readonly y: number }) => void) | undefined;
  readonly onDragStart?: ((event: DragEvent<HTMLButtonElement>) => void) | undefined;
  readonly onDragEnd?: (() => void) | undefined;
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
  selected = false,
  favorite = false,
  status = 'local',
  showStatus = true,
  previewFailure,
  onClick,
  onToggleSelect,
  onContextAction,
  onDragStart,
  onDragEnd,
}: PhotoTileProps): ReactElement {
  const intl = useIntl();
  const unavailableLabel = previewFailureLabel(intl, previewFailure);
  const classes = ['ovl-tile', selected ? 'ovl-tile--selected' : undefined, status === 'offloaded' ? 'ovl-tile--offloaded' : undefined]
    .filter(Boolean)
    .join(' ');
  return (
    <div role="group" className={classes}>
      <PhotoOpenButton
        label={alt === '' ? 'Open photo' : `Open ${alt}`}
        className="ovl-tile__open"
        onOpen={onClick}
        onContextAction={onContextAction}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
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
          aria-label={selected ? 'Deselect' : 'Select'}
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
