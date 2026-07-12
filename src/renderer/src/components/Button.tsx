import type { ButtonHTMLAttributes, ReactElement } from 'react';

import './controls.css';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ControlSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ControlSize;
  readonly icon?: IconName;
}

// components/core/Button.jsx — hover/press fills ride CSS pseudo-classes
// (same token progression as the mock's JS state).
export function Button({ variant = 'secondary', size = 'md', icon, className, children, ...rest }: ButtonProps): ReactElement {
  const classes = ['ovl-button', `ovl-button--${variant}`, `ovl-button--${size}`, className].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} {...rest}>
      {icon === undefined ? null : <Icon name={icon} size={size === 'lg' ? 18 : 16} />}
      {children}
    </button>
  );
}
