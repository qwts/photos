import type { ReactElement } from 'react';

import './feedback.css';

export type ProgressTone = 'cyan' | 'amber' | 'green';

export interface ProgressBarProps {
  readonly value: number;
  readonly max?: number;
  readonly tone?: ProgressTone;
  readonly label: string;
  /** Mono counter, e.g. "842 / 1,204". */
  readonly detail?: string;
  readonly width?: number | string;
}

// feedback/ProgressBar.jsx — 4px track, width animates 200ms.
export function ProgressBar({ value, max = 100, tone = 'cyan', label, detail, width = '100%' }: ProgressBarProps): ReactElement {
  const clamped = Math.max(0, Math.min(max, value));
  const pct = (clamped / max) * 100;
  return (
    <div className="ovl-progress" style={{ width }}>
      <div className="ovl-progress__head">
        <span className="ovl-progress__label">{label}</span>
        {detail === undefined ? null : <span className="ovl-progress__detail">{detail}</span>}
      </div>
      <div
        className="ovl-progress__track"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div className={`ovl-progress__fill ovl-progress__fill--${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
