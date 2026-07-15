import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { formatBytes, formatCount } from '../../../shared/library/format.js';
import type { LibraryStats } from '../../../shared/library/types.js';
import { Button } from '../components/Button';
import { Field } from './Field';

export interface OffloadedStorageProps {
  readonly connected: boolean;
  readonly selectedPhotoIds: readonly string[];
}

export function OffloadedStorage({ connected, selectedPhotoIds }: OffloadedStorageProps): ReactElement {
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [restoring, setRestoring] = useState<'selected' | 'all' | null>(null);
  const [result, setResult] = useState<{ readonly message: string; readonly failed: boolean } | null>(null);
  const refresh = useCallback(() => {
    void window.overlook.library.stats().then(setStats);
  }, []);

  useEffect(() => {
    refresh();
    return window.overlook.library.onStorageChanged(refresh);
  }, [refresh]);

  const restore = (mode: 'selected' | 'all'): void => {
    setRestoring(mode);
    setResult(null);
    const photoIds = mode === 'selected' ? [...selectedPhotoIds] : undefined;
    void window.overlook.backup
      .restoreOriginals(photoIds === undefined ? {} : { photoIds })
      .then(({ restored, skipped, failed }) => {
        const details = [`${formatCount(restored)} restored`];
        if (skipped > 0) details.push(`${formatCount(skipped)} skipped`);
        if (failed > 0) details.push(`${formatCount(failed)} failed`);
        setResult({ message: details.join(' · '), failed: failed > 0 });
        refresh();
      })
      .catch(() => {
        setResult({ message: 'Restore failed — originals remain offloaded', failed: true });
      })
      .finally(() => setRestoring(null));
  };

  const offloadedBytes = stats?.offloadedBytes ?? 0;
  const busy = restoring !== null;
  return (
    <Field
      label="Offloaded originals"
      hint={`${formatBytes(offloadedBytes)} stored only in your verified cloud backup. Thumbnails remain on this Mac.`}
    >
      <div className="ovl-settings__restoreOriginals" aria-live="polite">
        <div className="ovl-settings__restoreActions">
          <Button size="sm" disabled={!connected || selectedPhotoIds.length === 0 || busy} onClick={() => restore('selected')}>
            {restoring === 'selected' ? 'Restoring…' : `Restore selected (${formatCount(selectedPhotoIds.length)})`}
          </Button>
          <Button size="sm" disabled={!connected || offloadedBytes === 0 || busy} onClick={() => restore('all')}>
            {restoring === 'all' ? 'Restoring…' : 'Restore all'}
          </Button>
        </div>
        {!connected && offloadedBytes > 0 ? (
          <div className="ovl-settings__restoreState">Connect the backup provider to restore.</div>
        ) : null}
        {result === null ? null : (
          <div className={`ovl-settings__restoreState${result.failed ? ' ovl-settings__restoreState--error' : ''}`}>{result.message}</div>
        )}
      </div>
    </Field>
  );
}
