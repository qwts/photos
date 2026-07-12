import type { ButtonHTMLAttributes, ReactElement } from 'react';

import './controls.css';
import { Icon, type IconName } from './Icon';
import type { ControlSize } from './Button';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon: IconName;
  readonly size?: ControlSize;
  /** Cyan tint for a stuck-on state (e.g. inspector open, active filter). */
  readonly active?: boolean;
}

// components/core/IconButton.jsx — square control, 24/28/34px.
export function IconButton({ icon, size = 'md', active = false, className, ...rest }: IconButtonProps): ReactElement {
  const classes = ['ovl-icon-button', `ovl-icon-button--${size}`, active ? 'ovl-icon-button--active' : undefined, className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={classes} {...rest}>
      <Icon name={icon} size={size === 'lg' ? 20 : 16} />
    </button>
  );
}
