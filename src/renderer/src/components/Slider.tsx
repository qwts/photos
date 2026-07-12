import type { ReactElement } from 'react';

import './inputs.css';

export interface SliderProps {
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly onChange: (value: number) => void;
  readonly width?: number;
  /** Accessible name (e.g. "Zoom", "Upload bandwidth limit"). */
  readonly label: string;
}

// components/forms/Slider.jsx — the fill gradient tracks the value; thumb
// styling comes from inputs.css (not an injected style tag).
export function Slider({ value, min = 0, max = 100, step = 1, onChange, width = 140, label }: SliderProps): ReactElement {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className="ovl-slider"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => {
        onChange(Number(event.target.value));
      }}
      style={{
        width,
        backgroundImage: `linear-gradient(to right, var(--white-2) ${pct}%, var(--gray-4) ${pct}%)`,
      }}
    />
  );
}
