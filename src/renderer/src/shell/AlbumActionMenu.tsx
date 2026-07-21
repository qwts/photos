import type { ReactElement } from 'react';
import { useIntl } from 'react-intl';

import type { AlbumSummary } from '../../../shared/library/types.js';
import { commandById } from '../../../shared/commands/registry.js';
import { ContextMenu } from '../components/ContextMenu';

export interface AlbumActionMenuProps {
  readonly album: AlbumSummary;
  readonly x: number;
  readonly y: number;
  readonly onRename: () => void;
  readonly onDelete: () => void;
  readonly onTransfer: () => void;
  readonly onClose: () => void;
}

export function AlbumActionMenu({ album, x, y, onRename, onDelete, onTransfer, onClose }: AlbumActionMenuProps): ReactElement {
  const intl = useIntl();
  return (
    <ContextMenu
      label={`Actions for ${album.name}`}
      x={x}
      y={y}
      onClose={onClose}
      closeOnSelect={false}
      items={[
        { id: 'album.rename', label: intl.formatMessage(commandById('album.rename').label), icon: 'album', action: onRename },
        { id: 'album.transfer', label: intl.formatMessage(commandById('album.transfer').label), icon: 'refresh-cw', action: onTransfer },
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
