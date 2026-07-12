import type { ButtonHTMLAttributes, ReactElement } from 'react';

import './forms.css';
import { Icon, type IconName } from './Icon';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly selected?: boolean;
  readonly icon?: IconName;
  /** Renders the removable ×; its click never triggers the chip itself. */
  readonly onRemove?: () => void;
}

// components/forms/Chip.jsx — filter pill. The remove affordance is a real
// (nested-safe) button so it is keyboard/screen-reader operable, unlike the
// mock's span.
export function Chip({ selected = false, icon, onRemove, className, children, ...rest }: ChipProps): ReactElement {
  const classes = ['ovl-chip', selected ? 'ovl-chip--selected' : undefined, className].filter(Boolean).join(' ');
  return (
    <button type="button" aria-pressed={selected} className={classes} {...rest}>
      {icon === undefined ? null : <Icon name={icon} size={13} />}
      {children}
      {onRemove === undefined ? null : (
        <span
          role="button"
          tabIndex={0}
          aria-label="Remove filter"
          className="ovl-chip__remove"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onRemove();
            }
          }}
        >
          <Icon name="x" size={12} />
        </span>
      )}
    </button>
  );
}
