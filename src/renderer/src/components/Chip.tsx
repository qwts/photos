import type { ButtonHTMLAttributes, ReactElement } from 'react';

import './forms.css';
import { Icon, type IconName } from './Icon';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly selected?: boolean;
  readonly icon?: IconName;
  /** Renders the removable ×; its click never triggers the chip itself. */
  readonly onRemove?: () => void;
}

// components/forms/Chip.jsx — filter pill. A removable chip renders the pill
// as a wrapper with the toggle and the × as SIBLING buttons (never nested
// interactive controls — PR #143 review); without onRemove the chip is a
// single button.
export function Chip({ selected = false, icon, onRemove, className, children, ...rest }: ChipProps): ReactElement {
  const pill = ['ovl-chip', selected ? 'ovl-chip--selected' : undefined, className].filter(Boolean).join(' ');
  const content = (
    <>
      {icon === undefined ? null : <Icon name={icon} size={13} />}
      {children}
    </>
  );
  if (onRemove === undefined) {
    return (
      <button type="button" aria-pressed={selected} className={pill} {...rest}>
        {content}
      </button>
    );
  }
  return (
    <span className={pill}>
      <button type="button" aria-pressed={selected} className="ovl-chip__main" {...rest}>
        {content}
      </button>
      <button
        type="button"
        aria-label="Remove filter"
        className="ovl-chip__remove"
        onClick={() => {
          onRemove();
        }}
      >
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}
