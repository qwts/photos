import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { FormattedMessage, defineMessages, useIntl } from 'react-intl';

import './move-library.css';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { IconButton } from '../components/IconButton';

const messages = defineMessages({
  corrupt: {
    id: 'libmove.banner.corrupt',
    defaultMessage: 'A library move journal is damaged. Nothing was changed — both locations are untouched.',
  },
  pending: {
    id: 'libmove.banner.pending',
    defaultMessage: 'A finished library move still has its original in place. Both copies are verified — finishing removes the original.',
  },
  finishCleanup: { id: 'libmove.banner.finishCleanup', defaultMessage: 'Finish cleanup' },
  dismiss: { id: 'libmove.banner.dismiss', defaultMessage: 'Dismiss' },
  paths: { id: 'libmove.banner.paths', defaultMessage: '{from} → {to}' },
});

// Relocation resume banner (#483, ADR-0022 §2). Startup recovery already
// settled every pre-commit journal (discard) and rolled forward committed
// crashes — what can still be pending at runtime is exactly two things:
// a committed move whose source cleanup failed (both copies verified,
// finish it here), and a corrupt journal (surfaced, never guessed at).

type PendingMove = Awaited<ReturnType<typeof window.overlook.libraries.pendingMoves>>['pending'][number];

export function MoveResumeBanner(): ReactElement | null {
  const intl = useIntl();
  const [pending, setPending] = useState<readonly PendingMove[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void window.overlook.libraries
      .pendingMoves()
      .then(({ pending: entries }) => setPending(entries.filter((entry) => entry.corrupt || entry.state === 'committed')))
      .catch(() => undefined);
  }, []);

  if (dismissed || pending.length === 0) return null;

  const finishCleanup = (entry: PendingMove): void => {
    void window.overlook.libraries.finishMoveCleanup({ id: entry.libraryId }).then(() => {
      setPending((previous) => previous.filter((candidate) => candidate.libraryId !== entry.libraryId));
    });
  };

  return (
    <div className="ovl-movebanner" role="status" data-testid="move-resume-banner">
      {pending.map((entry) => (
        <div key={entry.libraryId} className="ovl-movebanner__row">
          <Icon name={entry.corrupt ? 'triangle-alert' : 'hard-drive'} size={16} color="var(--accent-amber)" />
          {entry.corrupt ? (
            <span className="ovl-movebanner__copy">
              <FormattedMessage {...messages.corrupt} />
            </span>
          ) : (
            <>
              <span className="ovl-movebanner__copy">
                <FormattedMessage {...messages.pending} />
                <span className="mono-data ovl-movebanner__paths">
                  <FormattedMessage {...messages.paths} values={{ from: entry.sourcePath, to: entry.destPath }} />
                </span>
              </span>
              <Button size="sm" onClick={() => finishCleanup(entry)} data-testid="move-banner-cleanup">
                <FormattedMessage {...messages.finishCleanup} />
              </Button>
            </>
          )}
        </div>
      ))}
      <IconButton icon="x" label={intl.formatMessage(messages.dismiss)} size="sm" onClick={() => setDismissed(true)} />
    </div>
  );
}
