import { useState, type ReactElement } from 'react';

import { formatBytes, formatCount } from '../../../shared/library/format.js';
import { useAppDispatch } from '../state/app-state-context';
import { OffloadDialog } from './OffloadDialog';

interface Request {
  readonly photoIds: readonly string[];
  readonly clearSelection: boolean;
  readonly afterSuccess: (() => void) | undefined;
}

export interface OffloadWorkflow {
  readonly open: (photoIds: readonly string[], clearSelection?: boolean, afterSuccess?: () => void) => void;
  readonly activePhotoIds: readonly string[] | null;
  readonly dialog: ReactElement | null;
}

export function useOffloadWorkflow(): OffloadWorkflow {
  const dispatch = useAppDispatch();
  const [request, setRequest] = useState<Request | null>(null);
  const open = (photoIds: readonly string[], clearSelection = false, afterSuccess?: () => void): void => {
    setRequest({ photoIds: [...new Set(photoIds)], clearSelection, afterSuccess });
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
          if (result.offloaded > 0) request.afterSuccess?.();
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
  return { open, activePhotoIds: request?.photoIds ?? null, dialog };
}
