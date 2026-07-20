import type { ReactElement } from 'react';

import './pill.css';
import { useFormats } from '../i18n/use-formats.js';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';

export interface PurgeConfirmProps {
  readonly count: number;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

// The destructive confirm (#121): red button, exact counts, "Delete"
// language per the DS rules (Clear = undoable, Delete = destructive).
export function PurgeConfirm({ count, onCancel, onConfirm }: PurgeConfirmProps): ReactElement {
  const { formatCount } = useFormats();
  const noun = count === 1 ? 'photo' : 'photos';
  return (
    <Dialog
      open
      title="Delete photos"
      icon="trash-2"
      width={420}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" icon="trash-2" onClick={onConfirm}>
            Delete {formatCount(count)} {noun}
          </Button>
        </>
      }
    >
      <p className="ovl-purge__copy">
        Permanently deletes {formatCount(count)} {noun} from this device and the connected provider. This can&rsquo;t be undone.
      </p>
    </Dialog>
  );
}
