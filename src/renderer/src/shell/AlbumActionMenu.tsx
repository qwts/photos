import type { ReactElement } from 'react';
import { useIntl } from 'react-intl';

import type { AlbumSummary } from '../../../shared/library/types.js';
import { commandById, formatShortcut, type CommandPlatform } from '../../../shared/commands/registry.js';
import { ContextMenu } from '../components/ContextMenu';
import type { AlbumReorderCommand } from './use-album-reorder';

export interface AlbumActionMenuProps {
  readonly album: AlbumSummary;
  readonly x: number;
  readonly y: number;
  readonly onRename: () => void;
  readonly onDelete: () => void;
  readonly onTransfer?: (() => void) | undefined;
  readonly position: number;
  readonly total: number;
  readonly platform: CommandPlatform;
  readonly onReorder: (command: AlbumReorderCommand) => void;
  readonly onClose: () => void;
}

export function AlbumActionMenu({
  album,
  x,
  y,
  onRename,
  onDelete,
  onTransfer,
  position,
  total,
  platform,
  onReorder,
  onClose,
}: AlbumActionMenuProps): ReactElement {
  const intl = useIntl();
  const alreadyFirst = intl.formatMessage({ id: 'album.reorder.alreadyFirstShort', defaultMessage: 'Already first' });
  const alreadyLast = intl.formatMessage({ id: 'album.reorder.alreadyLastShort', defaultMessage: 'Already last' });
  return (
    <ContextMenu
      label={intl.formatMessage({ id: 'album.context.actions', defaultMessage: 'Actions for {album}' }, { album: album.name })}
      x={x}
      y={y}
      onClose={onClose}
      closeOnSelect={false}
      items={[
        {
          id: 'album.reorder.up',
          label: intl.formatMessage(commandById('album.reorder.up').label),
          icon: 'arrow-up',
          action: () => onReorder('album.reorder.up'),
          detail: formatShortcut(commandById('album.reorder.up'), platform),
          disabledReason: position === 0 ? alreadyFirst : undefined,
        },
        {
          id: 'album.reorder.down',
          label: intl.formatMessage(commandById('album.reorder.down').label),
          icon: 'arrow-down',
          action: () => onReorder('album.reorder.down'),
          detail: formatShortcut(commandById('album.reorder.down'), platform),
          disabledReason: position === total - 1 ? alreadyLast : undefined,
        },
        {
          id: 'album.reorder.top',
          label: intl.formatMessage(commandById('album.reorder.top').label),
          icon: 'chevrons-up',
          action: () => onReorder('album.reorder.top'),
          disabledReason: position === 0 ? alreadyFirst : undefined,
          separatorBefore: true,
        },
        {
          id: 'album.reorder.bottom',
          label: intl.formatMessage(commandById('album.reorder.bottom').label),
          icon: 'chevrons-down',
          action: () => onReorder('album.reorder.bottom'),
          disabledReason: position === total - 1 ? alreadyLast : undefined,
        },
        { id: 'album.rename', label: intl.formatMessage(commandById('album.rename').label), icon: 'album', action: onRename },
        ...(onTransfer === undefined
          ? []
          : [
              {
                id: 'album.transfer',
                label: intl.formatMessage(commandById('album.transfer').label),
                icon: 'refresh-cw' as const,
                action: onTransfer,
              },
            ]),
        {
          id: 'album.delete',
          label: intl.formatMessage(commandById('album.delete').label),
          icon: 'trash-2',
          action: onDelete,
          danger: true,
          separatorBefore: true,
        },
      ]}
    />
  );
}
