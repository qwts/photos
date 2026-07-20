import type { ReactElement } from 'react';

import './pill.css';
import { useFormats } from '../i18n/use-formats.js';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { destructiveActions } from '../../../shared/destructive-actions.js';

export interface PurgeConfirmProps {
  readonly count: number;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

// ADR-0023 Tier D ceremony: exact count, complete custody effects, honest
// partial-failure behavior, and an action-specific destructive label.
export function PurgeConfirm({ count, onCancel, onConfirm }: PurgeConfirmProps): ReactElement {
  const { formatCount } = useFormats();
  const noun = count === 1 ? 'photo' : 'photos';
  const action = destructiveActions.deletePhotosPermanently;
  return (
    <Dialog
      open
      title={`Delete ${formatCount(count)} ${noun} permanently?`}
      icon="trash-2"
      width={420}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" icon="trash-2" onClick={onConfirm}>
            Delete permanently
          </Button>
        </>
      }
    >
      <p className="ovl-purge__copy">{action.sideEffects} This cannot be undone.</p>
    </Dialog>
  );
}
