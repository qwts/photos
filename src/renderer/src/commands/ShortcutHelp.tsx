import type { ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';

import { activeShortcuts, formatShortcut, type CommandContext, type CommandPlatform } from '../../../shared/commands/registry.js';
import { Dialog } from '../components/Dialog';

import './shortcuts.css';

export function ShortcutHelp({
  context,
  platform,
  onClose,
}: {
  readonly context: CommandContext;
  readonly platform: CommandPlatform;
  readonly onClose: () => void;
}): ReactElement {
  const intl = useIntl();
  const commands = activeShortcuts({ ...context, dialogOpen: false, editable: false });
  return (
    <Dialog
      open
      title={intl.formatMessage({ id: 'commands.help.title', defaultMessage: 'Keyboard shortcuts' })}
      icon="key-round"
      onClose={onClose}
    >
      <div className="ovl-shortcuts" data-testid="shortcut-help">
        <p className="ovl-shortcuts__intro">
          <FormattedMessage id="commands.help.intro" defaultMessage="Available in the current view" />
        </p>
        <dl className="ovl-shortcuts__list">
          {commands.map((command) => (
            <div key={command.id} className="ovl-shortcuts__row">
              <dt>{intl.formatMessage(command.label)}</dt>
              <dd>
                <kbd>{formatShortcut(command, platform)}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Dialog>
  );
}
