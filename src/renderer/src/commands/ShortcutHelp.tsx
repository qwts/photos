import type { ReactElement } from 'react';
import { FormattedMessage, defineMessages, useIntl, type MessageDescriptor } from 'react-intl';

import {
  activeShortcuts,
  formatShortcut,
  type CommandContext,
  type CommandId,
  type CommandPlatform,
} from '../../../shared/commands/registry.js';
import { Dialog } from '../components/Dialog';

import './shortcuts.css';

const commandLabels: Record<CommandId, MessageDescriptor> = defineMessages({
  'app.search.focus': { id: 'commands.app.search.focus', defaultMessage: 'Focus search' },
  'selection.selectAll': { id: 'commands.selection.selectAll', defaultMessage: 'Select all photos' },
  'selection.clear': { id: 'commands.selection.clear', defaultMessage: 'Clear selection' },
  'view.inspector.toggle': { id: 'commands.view.inspector.toggle', defaultMessage: 'Show or hide Inspector' },
  'view.lightbox.close': { id: 'commands.view.lightbox.close', defaultMessage: 'Exit lightbox' },
  'view.lightbox.previous': { id: 'commands.view.lightbox.previous', defaultMessage: 'Previous photo' },
  'view.lightbox.next': { id: 'commands.view.lightbox.next', defaultMessage: 'Next photo' },
  'photo.favorite.toggle': { id: 'commands.photo.favorite.toggle', defaultMessage: 'Toggle favorite' },
  'photo.trash': { id: 'commands.photo.trash', defaultMessage: 'Move photo to Trash' },
  'view.lightbox.zoomIn': { id: 'commands.view.lightbox.zoomIn', defaultMessage: 'Zoom in' },
  'view.lightbox.zoomOut': { id: 'commands.view.lightbox.zoomOut', defaultMessage: 'Zoom out' },
  'view.lightbox.zoomReset': { id: 'commands.view.lightbox.zoomReset', defaultMessage: 'Reset zoom' },
  'view.lightbox.rotateLeft': { id: 'commands.view.lightbox.rotateLeft', defaultMessage: 'Rotate left' },
  'view.lightbox.rotateRight': { id: 'commands.view.lightbox.rotateRight', defaultMessage: 'Rotate right' },
  'view.lightbox.flipHorizontal': { id: 'commands.view.lightbox.flipHorizontal', defaultMessage: 'Flip horizontally' },
  'view.lightbox.orientationReset': { id: 'commands.view.lightbox.orientationReset', defaultMessage: 'Reset orientation' },
  'help.shortcuts': { id: 'commands.help.shortcuts', defaultMessage: 'Keyboard shortcuts' },
  'grid.focus.left': { id: 'commands.grid.focus.left', defaultMessage: 'Move focus left' },
  'grid.focus.right': { id: 'commands.grid.focus.right', defaultMessage: 'Move focus right' },
  'grid.focus.up': { id: 'commands.grid.focus.up', defaultMessage: 'Move focus up' },
  'grid.focus.down': { id: 'commands.grid.focus.down', defaultMessage: 'Move focus down' },
  'grid.focus.home': { id: 'commands.grid.focus.home', defaultMessage: 'Move to row start' },
  'grid.focus.end': { id: 'commands.grid.focus.end', defaultMessage: 'Move to row end' },
  'grid.focus.pageUp': { id: 'commands.grid.focus.pageUp', defaultMessage: 'Move up one page' },
  'grid.focus.pageDown': { id: 'commands.grid.focus.pageDown', defaultMessage: 'Move down one page' },
});

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
              <dt>{intl.formatMessage(commandLabels[command.id])}</dt>
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
