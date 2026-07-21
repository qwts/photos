import type { ReactElement } from 'react';

import type { AppState } from '../../../shared/library/app-state.js';
import { useFormats } from '../i18n/use-formats.js';
import { useAppDispatch } from '../state/app-state-context';

export function ToastAction({ toast }: { readonly toast: NonNullable<AppState['toast']> }): ReactElement | null {
  const { formatCount } = useFormats();
  const dispatch = useAppDispatch();
  if (toast.action === undefined) return null;
  const run = (): void => {
    if (toast.action === 'show-recent') {
      dispatch({ type: 'source/set', source: 'recent' });
      dispatch({ type: 'toast/dismissed' });
      return;
    }
    if (toast.action === 'retry-backup') {
      dispatch({ type: 'toast/dismissed' });
      void window.overlook.backup.run({}).then(({ skipped }) => {
        if (skipped === 'disconnected') {
          dispatch({ type: 'toast/shown', toast: { title: 'Backup off — not connected', tone: 'neutral' } });
        }
      });
      return;
    }
    const photoIds = toast.actionPhotoIds ?? [];
    dispatch({ type: 'toast/dismissed' });
    if (photoIds.length === 0) return;
    void window.overlook.backup
      .restoreOriginals({ photoIds: [...photoIds] })
      .then(({ restored, failed }) => {
        dispatch({
          type: 'toast/shown',
          toast:
            failed > 0
              ? { title: `Restored ${formatCount(restored)} · ${formatCount(failed)} failed`, tone: 'red' }
              : { title: `Restored ${formatCount(restored)} ${restored === 1 ? 'original' : 'originals'}`, tone: 'green' },
        });
      })
      .catch(() => {
        dispatch({ type: 'toast/shown', toast: { title: 'Restore failed — originals remain offloaded', tone: 'red' } });
      });
  };
  return (
    <button type="button" className="ovl-toast__action" onClick={run}>
      {toast.action === 'show-recent' ? 'Show' : toast.action === 'retry-backup' ? 'Retry' : 'Undo'}
    </button>
  );
}
