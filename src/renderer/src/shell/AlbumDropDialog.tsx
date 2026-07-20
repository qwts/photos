import type { ReactElement } from 'react';

import type { AlbumSummary } from '../../../shared/library/types.js';
import { useFormats } from '../i18n/use-formats.js';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';

export function AlbumDropDialog({
  count,
  source,
  target,
  onAdd,
  onMove,
  onClose,
}: {
  readonly count: number;
  readonly source: AlbumSummary;
  readonly target: AlbumSummary;
  readonly onAdd: () => void;
  readonly onMove: () => void;
  readonly onClose: () => void;
}): ReactElement {
  const { formatCount } = useFormats();
  const photos = `${formatCount(count)} ${count === 1 ? 'photo' : 'photos'}`;
  return (
    <Dialog
      open
      title={count === 1 ? 'Add or move photo?' : 'Add or move photos?'}
      icon="album"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={onAdd}>
            Add to {target.name}
          </Button>
          <Button variant="primary" onClick={onMove}>
            Move to {target.name}
          </Button>
        </>
      }
    >
      <p>
        Organize {photos} from “{source.name}” into “{target.name}”.
      </p>
      <p className="ovl-album-dialog__safe-copy">
        Add keeps the {count === 1 ? 'photo' : 'photos'} in both albums. Move confirms the target membership before removing only the source
        membership. Your library photos are never deleted.
      </p>
    </Dialog>
  );
}
