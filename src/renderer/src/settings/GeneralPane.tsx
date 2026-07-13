import type { ReactElement } from 'react';

import { Segmented } from '../components/Segmented';
import { Switch } from '../components/Switch';
import { Field } from './Field';
import type { AppSettings } from '../../../shared/settings/settings.js';

// General section (#113): sort order drives the grid query live; appearance
// ships with Light disabled (the DS has no light theme — conflict with the
// mock recorded on the epic); thumbnails-on-import is locked on with its
// rationale, matching the schema's literal.

export interface GeneralPaneProps {
  readonly settings: AppSettings;
  readonly onPatch: (patch: Partial<Pick<AppSettings, 'sortOrder' | 'appearance'>>) => void;
}

export function GeneralPane({ settings, onPatch }: GeneralPaneProps): ReactElement {
  return (
    <div className="ovl-settings__fields">
      <Field label="Default sort order">
        <Segmented
          label="Default sort order"
          value={settings.sortOrder}
          options={[
            { value: 'date', label: 'Date' },
            { value: 'name', label: 'Name' },
            { value: 'size', label: 'Size' },
          ]}
          onChange={(sortOrder) => {
            onPatch({ sortOrder });
          }}
        />
      </Field>
      <Field label="Appearance" hint="Dark only for now — a light theme isn't part of the design system yet.">
        <Segmented
          label="Appearance"
          value={settings.appearance}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light', disabled: true },
          ]}
          onChange={(appearance) => {
            onPatch({ appearance });
          }}
        />
      </Field>
      <Field label="Generate thumbnails on import" hint="The grid browses thumbnails, even offline. Cannot be disabled.">
        <Switch checked disabled />
      </Field>
    </div>
  );
}
