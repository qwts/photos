import type { ReactElement } from 'react';

import './feedback.css';

export interface MetadataRowProps {
  readonly label: string;
  readonly value: string;
  /** Machine data defaults to mono; prose rows opt out. */
  readonly mono?: boolean;
  /** Color override, e.g. var(--accent-green) for an encrypted backup. */
  readonly tone?: string;
}

// media/MetadataRow.jsx — 88px uppercase-mono label + truncating value.
export function MetadataRow({ label, value, mono = true, tone }: MetadataRowProps): ReactElement {
  return (
    <dl className="ovl-metadata-row">
      <dt className="ovl-metadata-row__label">{label}</dt>
      <dd
        className={`ovl-metadata-row__value${mono ? '' : ' ovl-metadata-row__value--sans'}`}
        style={tone === undefined ? undefined : { color: tone }}
      >
        {value}
      </dd>
    </dl>
  );
}
