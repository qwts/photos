import type { ReactElement } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import { QUICK_ACTION_COMMANDS, type QuickActionCommandId } from '../../../shared/commands/registry.js';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Switch } from '../components/Switch';

const messages = defineMessages({
  moveUp: { id: 'settings.general.quickActions.moveUp', defaultMessage: 'Move {action} up' },
  moveDown: { id: 'settings.general.quickActions.moveDown', defaultMessage: 'Move {action} down' },
  maxReached: {
    id: 'settings.general.quickActions.maxReached',
    defaultMessage: 'Disable an action before enabling another.',
  },
  up: { id: 'settings.general.quickActions.up', defaultMessage: 'Up' },
  down: { id: 'settings.general.quickActions.down', defaultMessage: 'Down' },
});

export interface QuickActionsSettingsProps {
  readonly value: readonly QuickActionCommandId[];
  readonly onChange: (value: readonly QuickActionCommandId[]) => void;
}

export function QuickActionsSettings({ value, onChange }: QuickActionsSettingsProps): ReactElement {
  const intl = useIntl();
  const enabled = new Set(value);
  const commandsById = new Map(QUICK_ACTION_COMMANDS.map((command) => [command.id, command]));
  const commands = [
    ...value
      .map((id) => commandsById.get(id))
      .filter((command): command is (typeof QUICK_ACTION_COMMANDS)[number] => command !== undefined),
    ...QUICK_ACTION_COMMANDS.filter(({ id }) => !enabled.has(id)),
  ];

  const toggle = (id: QuickActionCommandId, checked: boolean): void => {
    onChange(checked ? [...value, id] : value.filter((candidate) => candidate !== id));
  };

  const move = (index: number, offset: -1 | 1): void => {
    const next = [...value];
    const [item] = next.splice(index, 1);
    if (item === undefined) return;
    next.splice(index + offset, 0, item);
    onChange(next);
  };

  return (
    <div className="ovl-quick-action-settings">
      {commands.map((command) => {
        const checked = enabled.has(command.id);
        const index = value.indexOf(command.id);
        const label = intl.formatMessage(command.label);
        const maxReached = !checked && value.length >= 5;
        return (
          <div className="ovl-quick-action-settings__row" key={command.id}>
            <Icon name={command.quickAction.icon} size={14} />
            <Switch
              checked={checked}
              disabled={maxReached}
              label={label}
              onChange={(nextChecked) => {
                toggle(command.id, nextChecked);
              }}
            />
            {checked ? (
              <div className="ovl-quick-action-settings__order">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={index === 0}
                  aria-label={intl.formatMessage(messages.moveUp, { action: label })}
                  onClick={() => {
                    move(index, -1);
                  }}
                >
                  {intl.formatMessage(messages.up)}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={index === value.length - 1}
                  aria-label={intl.formatMessage(messages.moveDown, { action: label })}
                  onClick={() => {
                    move(index, 1);
                  }}
                >
                  {intl.formatMessage(messages.down)}
                </Button>
              </div>
            ) : maxReached ? (
              <span className="ovl-quick-action-settings__reason">{intl.formatMessage(messages.maxReached)}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
