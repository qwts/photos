import type { ReactElement } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import { Segmented } from '../components/Segmented';
import { Switch } from '../components/Switch';
import { Field } from './Field';
import type { AppSettings } from '../../../shared/settings/settings.js';

// General section (#113): sort order drives the grid query live; appearance
// ships with Light disabled (the DS has no light theme — conflict with the
// mock recorded on the epic); thumbnails-on-import is locked on with its
// rationale, matching the schema's literal.

const messages = defineMessages({
  sortOrder: { id: 'settings.general.sortOrder', defaultMessage: 'Default sort order' },
  sortDate: { id: 'settings.general.sort.date', defaultMessage: 'Date' },
  sortName: { id: 'settings.general.sort.name', defaultMessage: 'Name' },
  sortSize: { id: 'settings.general.sort.size', defaultMessage: 'Size' },
  appearance: { id: 'settings.general.appearance', defaultMessage: 'Appearance' },
  appearanceHint: {
    id: 'settings.general.appearance.hint',
    defaultMessage: "Dark only for now — a light theme isn't part of the design system yet.",
  },
  dark: { id: 'settings.general.appearance.dark', defaultMessage: 'Dark' },
  light: { id: 'settings.general.appearance.light', defaultMessage: 'Light' },
  thumbnails: { id: 'settings.general.thumbnails', defaultMessage: 'Generate thumbnails on import' },
  thumbnailsHint: {
    id: 'settings.general.thumbnails.hint',
    defaultMessage: 'The grid browses thumbnails, even offline. Cannot be disabled.',
  },
});

export interface GeneralPaneProps {
  readonly settings: AppSettings;
  readonly onPatch: (patch: Partial<Pick<AppSettings, 'sortOrder' | 'appearance'>>) => void;
}

export function GeneralPane({ settings, onPatch }: GeneralPaneProps): ReactElement {
  const intl = useIntl();
  return (
    <div className="ovl-settings__fields">
      <Field label={intl.formatMessage(messages.sortOrder)}>
        <Segmented
          label={intl.formatMessage(messages.sortOrder)}
          value={settings.sortOrder}
          options={[
            { value: 'date', label: intl.formatMessage(messages.sortDate) },
            { value: 'name', label: intl.formatMessage(messages.sortName) },
            { value: 'size', label: intl.formatMessage(messages.sortSize) },
          ]}
          onChange={(sortOrder) => {
            onPatch({ sortOrder });
          }}
        />
      </Field>
      <Field label={intl.formatMessage(messages.appearance)} hint={intl.formatMessage(messages.appearanceHint)}>
        <Segmented
          label={intl.formatMessage(messages.appearance)}
          value={settings.appearance}
          options={[
            { value: 'dark', label: intl.formatMessage(messages.dark) },
            { value: 'light', label: intl.formatMessage(messages.light), disabled: true },
          ]}
          onChange={(appearance) => {
            onPatch({ appearance });
          }}
        />
      </Field>
      <Field label={intl.formatMessage(messages.thumbnails)} hint={intl.formatMessage(messages.thumbnailsHint)}>
        <Switch checked disabled accessibleLabel={intl.formatMessage(messages.thumbnails)} />
      </Field>
    </div>
  );
}
