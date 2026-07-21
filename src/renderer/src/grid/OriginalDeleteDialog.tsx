import { useEffect, useState, type ReactElement } from 'react';

import { ORIGINAL_DELETE_AUTHORIZATION, destructiveActions } from '../../../shared/destructive-actions.js';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { PasswordField } from '../components/PasswordField';

type Preflight = Awaited<ReturnType<typeof window.overlook.library.originalDeletePreflight>>;

export interface OriginalDeleteDialogProps {
  readonly photoIds: readonly string[];
  readonly onClose: () => void;
  readonly onDeleted: (result: { readonly purged: number; readonly remoteFailures: number }) => void;
}

export function OriginalDeleteDialog({ photoIds, onClose, onDeleted }: OriginalDeleteDialogProps): ReactElement {
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [password, setPassword] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.overlook.library
      .originalDeletePreflight({ photoIds: [...photoIds] })
      .then((result) => {
        if (active) {
          setPreflight(result);
          setAuthorized(!result.passwordRequired);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Deletion authorization failed');
      });
    return () => {
      active = false;
    };
  }, [photoIds]);

  const cancel = (): void => {
    if (preflight !== null) void window.overlook.library.originalDeleteCancel({ challengeId: preflight.challengeId });
    onClose();
  };
  const count = preflight?.count ?? photoIds.length;
  const target = preflight?.fileName ?? `${String(count)} photos`;
  const action = destructiveActions.deleteProtectedOriginals;
  return (
    <Dialog
      open
      title={authorized ? `Delete ${target} permanently?` : 'Authenticate Original deletion'}
      icon="shield-check"
      width={440}
      onClose={busy ? undefined : cancel}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
          {authorized ? (
            <Button
              variant="danger"
              icon="trash-2"
              disabled={busy || preflight === null}
              onClick={() => {
                if (preflight === null) return;
                setBusy(true);
                setError(null);
                void window.overlook.library
                  .originalDeleteCommit({ challengeId: preflight.challengeId, authorization: ORIGINAL_DELETE_AUTHORIZATION })
                  .then(onDeleted)
                  .catch((reason: unknown) => {
                    setBusy(false);
                    setError(reason instanceof Error ? reason.message : 'Deletion failed');
                  });
              }}
            >
              Delete permanently
            </Button>
          ) : (
            <Button
              variant="danger"
              disabled={busy || preflight === null || password.length === 0}
              onClick={() => {
                if (preflight === null) return;
                setBusy(true);
                setError(null);
                void window.overlook.library.originalDeleteAuthorize({ challengeId: preflight.challengeId, password }).then((result) => {
                  setBusy(false);
                  if (result.ok) {
                    setPassword('');
                    setAuthorized(true);
                  } else {
                    setError(result.reason === 'wrong-password' ? 'The app password is incorrect.' : 'Authorization is unavailable.');
                  }
                });
              }}
            >
              Authenticate
            </Button>
          )}
        </>
      }
    >
      {preflight === null && error === null ? <p>Preparing protected deletion…</p> : null}
      {!authorized && preflight !== null ? (
        <>
          <p>Confirm your app password before overriding Original protection.</p>
          <PasswordField value={password} onChange={setPassword} label="App password" autoComplete="current-password" />
        </>
      ) : null}
      {authorized && preflight !== null ? (
        <p>
          This overrides Original protection for {String(preflight.protected)} protected {preflight.protected === 1 ? 'photo' : 'photos'}.{' '}
          {action.sideEffects} This cannot be undone.
        </p>
      ) : null}
      {error === null ? null : <p role="alert">{error}</p>}
    </Dialog>
  );
}
