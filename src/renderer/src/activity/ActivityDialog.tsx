import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { FormattedDate, FormattedMessage, FormattedTime, defineMessages, useIntl } from 'react-intl';

import type { ActivityEvent, ActivityEventType } from '../../../shared/activity/types.js';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';

import './activity.css';

const messages = defineMessages({
  title: { id: 'activity.title', defaultMessage: 'Activity' },
  empty: { id: 'activity.empty', defaultMessage: 'Library activity will appear here.' },
  failed: { id: 'activity.failed', defaultMessage: 'Activity could not be loaded.' },
  loadMore: { id: 'activity.loadMore', defaultMessage: 'Load more' },
});

function countOf(event: ActivityEvent): number {
  return typeof event.payload['count'] === 'number'
    ? event.payload['count']
    : typeof event.payload['imported'] === 'number'
      ? event.payload['imported']
      : event.entityIds.length;
}

const eventMessages: Readonly<Record<ActivityEventType, { readonly id: string; readonly defaultMessage: string }>> = {
  'import.completed': { id: 'activity.event.import', defaultMessage: 'Imported {count, plural, one {# photo} other {# photos}}' },
  'album.created': { id: 'activity.event.albumCreated', defaultMessage: 'Created an album' },
  'album.renamed': { id: 'activity.event.albumRenamed', defaultMessage: 'Renamed an album' },
  'album.deleted': { id: 'activity.event.albumDeleted', defaultMessage: 'Deleted an album; photos were kept' },
  'album.membership-added': {
    id: 'activity.event.albumAdded',
    defaultMessage: 'Added {count, plural, one {# photo} other {# photos}} to an album',
  },
  'album.membership-removed': {
    id: 'activity.event.albumRemoved',
    defaultMessage: 'Removed {count, plural, one {# photo} other {# photos}} from an album',
  },
  'album.membership-moved': {
    id: 'activity.event.albumMoved',
    defaultMessage: 'Moved {count, plural, one {# photo} other {# photos}} between albums',
  },
  'photo.favorite-changed': { id: 'activity.event.favorite', defaultMessage: 'Changed a favorite' },
  'photo.trashed': {
    id: 'activity.event.trashed',
    defaultMessage: 'Moved {count, plural, one {# photo} other {# photos}} to Trash',
  },
  'photo.restored': {
    id: 'activity.event.restored',
    defaultMessage: 'Restored {count, plural, one {# photo} other {# photos}} from Trash',
  },
  'photo.exported': {
    id: 'activity.event.exported',
    defaultMessage: 'Exported {count, plural, one {# photo} other {# photos}}',
  },
  'photo.purged': {
    id: 'activity.event.purged',
    defaultMessage: 'Permanently deleted {count, plural, one {# photo} other {# photos}}',
  },
  'activity.pruned': { id: 'activity.event.pruned', defaultMessage: 'Expired old activity records' },
};

export function ActivityDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }): ReactElement {
  const intl = useIntl();
  const [events, setEvents] = useState<readonly ActivityEvent[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  const load = useCallback(async (next?: number): Promise<void> => {
    setStatus('loading');
    try {
      const page = await window.overlook.activity.page({ limit: 50, ...(next === undefined ? {} : { cursor: next }) });
      setEvents((current) => (next === undefined ? page.events : [...current, ...page.events]));
      setCursor(page.nextCursor);
      setStatus('ready');
    } catch {
      setStatus('failed');
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (open) {
      queueMicrotask(() => {
        if (active) void load();
      });
    }
    return () => {
      active = false;
    };
  }, [load, open]);

  return (
    <Dialog open={open} title={intl.formatMessage(messages.title)} icon="database" width={640} onClose={onClose}>
      <div className="ovl-activity" aria-busy={status === 'loading'}>
        <div className="sr-only" role="status" aria-live="polite">
          {status === 'loading' ? <FormattedMessage id="activity.loading" defaultMessage="Loading activity" /> : null}
        </div>
        {status === 'failed' ? <p className="ovl-activity__state">{intl.formatMessage(messages.failed)}</p> : null}
        {status === 'ready' && events.length === 0 ? <p className="ovl-activity__state">{intl.formatMessage(messages.empty)}</p> : null}
        {events.length > 0 ? (
          <ol className="ovl-activity__list" aria-label={intl.formatMessage(messages.title)}>
            {events.map((event) => (
              <li key={event.eventId} className="ovl-activity__item">
                <span className="ovl-activity__marker" aria-hidden="true" />
                <div className="ovl-activity__content">
                  <span className="ovl-activity__summary">
                    <FormattedMessage {...eventMessages[event.eventType]} values={{ count: countOf(event) }} />
                  </span>
                  <time className="ovl-activity__time mono-data" dateTime={event.occurredAt}>
                    <FormattedMessage
                      id="activity.timestamp"
                      defaultMessage="{date} · {time}"
                      values={{ date: <FormattedDate value={event.occurredAt} />, time: <FormattedTime value={event.occurredAt} /> }}
                    />
                  </time>
                  {event.outcome === 'partial' ? (
                    <span className="ovl-activity__partial">
                      <FormattedMessage id="activity.partial" defaultMessage="Completed with some items unresolved" />
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : null}
        {cursor === null ? null : (
          <div className="ovl-activity__more">
            <Button variant="ghost" disabled={status === 'loading'} onClick={() => void load(cursor)}>
              {intl.formatMessage(messages.loadMore)}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
