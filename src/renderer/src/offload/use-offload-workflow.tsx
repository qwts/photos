import { useState, type ReactElement } from 'react';

import { formatBytes, formatCount } from '../../../shared/library/format.js';
import { useAppDispatch } from '../state/app-state-context';
import { OffloadDialog } from './OffloadDialog';

interface Request {
  readonly photoIds: readonly string[];
  readonly clearSelection: boolean;
}

export interface OffloadWorkflow {
  readonly open: (photoIds: readonly string[], clearSelection?: boolean) => void;
  readonly dialog: ReactElement | null;
}

export function useOffloadWorkflow(): OffloadWorkflow {
  const dispatch = useAppDispatch();
  const [request, setRequest] = useState<Request | null>(null);
  const open = (photoIds: readonly string[], clearSelection = false): void => {
    setRequest({ photoIds: [...new Set(photoIds)], clearSelection });
  };
  const dialog =
    request === null ? null : (
      <OffloadDialog
        photoIds={request.photoIds}
        onClose={() => setRequest(null)}
        onComplete={(result) => {
          setRequest(null);
          const offloadedIds = result.results.filter(({ outcome }) => outcome === 'offloaded').map(({ photoId }) => photoId);
          if (result.offloaded > 0 && request.clearSelection) dispatch({ type: 'selection/cleared' });
          const skipped = result.skipped + result.failed;
          dispatch({
            type: 'toast/shown',
            toast:
              result.offloaded > 0
                ? {
                    title: `Offloaded ${formatCount(result.offloaded)} · Freed ${formatBytes(result.freedBytes)}`,
                    tone: skipped > 0 ? 'amber' : 'green',
                    action: 'undo-offload',
                    actionPhotoIds: offloadedIds,
                  }
                : {
                    title: result.failed > 0 ? 'OFFLOAD FAILED — ORIGINALS KEPT LOCAL' : `${formatCount(result.skipped)} originals skipped`,
                    tone: result.failed > 0 ? 'red' : 'amber',
                  },
          });
        }}
      />
    );
  return { open, dialog };
}
