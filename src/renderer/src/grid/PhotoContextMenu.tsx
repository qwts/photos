import type { ReactElement } from 'react';
import { useIntl } from 'react-intl';

import { commandById, type CommandId } from '../../../shared/commands/registry.js';
import type { PhotoRecord } from '../../../shared/library/types.js';
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu';
import type { IconName } from '../components/Icon';

export interface PhotoContextMenuProps {
  readonly photo: PhotoRecord;
  readonly targetCount: number;
  readonly inAlbum: boolean;
  readonly x: number;
  readonly y: number;
  readonly onOpen: () => void;
  readonly onToggleFavorite: () => void;
  readonly onExport: () => void;
  readonly onAddToAlbum: () => void;
  readonly onRemoveFromAlbum: () => void;
  readonly onOffload: () => void;
  readonly onRestoreOriginal: () => void;
  readonly onTransfer: () => void;
  readonly onTrash: () => void;
  readonly onRestore: () => void;
  readonly onPurge: () => void;
  readonly onClose: () => void;
}

export function PhotoContextMenu({
  photo,
  targetCount,
  inAlbum,
  x,
  y,
  onOpen,
  onToggleFavorite,
  onExport,
  onAddToAlbum,
  onRemoveFromAlbum,
  onOffload,
  onRestoreOriginal,
  onTransfer,
  onTrash,
  onRestore,
  onPurge,
  onClose,
}: PhotoContextMenuProps): ReactElement {
  const intl = useIntl();
  const item = (
    id: CommandId,
    icon: IconName,
    action: () => void,
    options?: Pick<ContextMenuItem, 'danger' | 'separatorBefore'>,
  ): ContextMenuItem => ({ id, label: intl.formatMessage(commandById(id).label), icon, action, ...options });
  const inTrash = photo.deletedAt !== null;
  const items: readonly ContextMenuItem[] = inTrash
    ? [item('photo.restore', 'rotate-ccw', onRestore), item('photo.purge', 'trash-2', onPurge, { danger: true, separatorBefore: true })]
    : [
        item('photo.open', 'image', onOpen),
        item('photo.favorite.toggle', 'star', onToggleFavorite),
        item('photo.export', 'share', onExport),
        item('album.membership.add', 'album', onAddToAlbum),
        ...(inAlbum ? [item('album.membership.remove', 'x', onRemoveFromAlbum)] : []),
        photo.syncState === 'offloaded'
          ? item('photo.restoreOriginal', 'cloud-download', onRestoreOriginal)
          : item('photo.offload', 'cloud-upload', onOffload),
        item('photo.transfer', 'refresh-cw', onTransfer),
        item('photo.trash', 'trash-2', onTrash, { danger: true, separatorBefore: true }),
      ];
  return (
    <ContextMenu
      label={intl.formatMessage(
        { id: 'photo.context.actions', defaultMessage: 'Actions for {target}' },
        { target: targetCount === 1 ? photo.fileName : `${targetCount} selected photos` },
      )}
      x={x}
      y={y}
      items={items}
      onClose={onClose}
    />
  );
}
