import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import './controls.css';

export interface TooltipProps {
  readonly label: string;
  readonly side?: 'top' | 'bottom';
  readonly children: ReactNode;
}

// components/core/Tooltip.jsx — JS-driven (not CSS :hover) exactly like the
// mock, which also keeps it drivable by the interaction tests' synthetic
// events. Focus/blur mirror hover so keyboard users get the same hint (PR
// #140 review); React's onFocus/onBlur bubble from the wrapped control.
// 200ms fade via --duration-normal.
export function Tooltip({ label, side = 'top', children }: TooltipProps): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="ovl-tooltip"
      onMouseEnter={() => {
        setOpen(true);
      }}
      onMouseLeave={() => {
        setOpen(false);
      }}
      onFocus={() => {
        setOpen(true);
      }}
      onBlur={() => {
        setOpen(false);
      }}
    >
      {children}
      {open ? (
        <span role="tooltip" className={`ovl-tooltip__bubble${side === 'bottom' ? ' ovl-tooltip__bubble--bottom' : ''}`}>
          {label}
        </span>
      ) : null}
    </span>
  );
}
