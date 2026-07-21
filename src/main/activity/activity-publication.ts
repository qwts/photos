import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

import type { ActivityAppend, ActivityEvent, ActivityEventType, ActivityOutcome, ActivityPage } from '../../shared/activity/types.js';
import { ActivityRepository } from './activity-repository.js';
import { ulid } from '../import/ulid.js';

export type ActivityDraft = {
  readonly eventType: ActivityEventType;
  readonly entityIds?: readonly string[];
  readonly outcome: ActivityOutcome;
  readonly payload?: ActivityAppend['payload'];
};

export interface ActivityFacade {
  page(limit: number, cursor?: number): ActivityPage;
  record(event: ActivityDraft): void;
  recordMutation<T>(mutation: () => T, activity: (result: T) => ActivityDraft | undefined): T;
}

export function mutateWithActivity<T>(
  getActivity: (() => ActivityFacade) | undefined,
  mutation: () => T,
  activity: (result: T) => ActivityDraft | undefined,
): T {
  return getActivity === undefined ? mutation() : getActivity().recordMutation(mutation, activity);
}

function materialize(event: ActivityDraft): ActivityAppend {
  const operationId = ulid();
  return {
    ...event,
    eventId: ulid(),
    operationId,
    rootCorrelationId: operationId,
    occurredAt: new Date().toISOString(),
  };
}

function enforceRetention(repository: ActivityRepository): boolean {
  const pruned = repository.prune(new Date());
  if (pruned === 0) return false;
  repository.append(materialize({ eventType: 'activity.pruned', outcome: 'succeeded', payload: { count: pruned } }));
  repository.prune(new Date());
  return true;
}

export function activityBackupSnapshot(db: BetterSqlite3.Database): readonly ActivityEvent[] {
  const repository = new ActivityRepository(db);
  repository.flushPending();
  enforceRetention(repository);
  return repository.backupSnapshot();
}

export function createActivityFacade(db: BetterSqlite3.Database, onChanged: () => void): ActivityFacade {
  const repository = new ActivityRepository(db);
  const append = (event: ActivityDraft): void => {
    repository.append(materialize(event));
    enforceRetention(repository);
  };
  return {
    page: (limit, cursor) => {
      const published = repository.flushPending();
      const changed = enforceRetention(repository);
      if (published > 0 || changed) onChanged();
      return repository.page(limit, cursor);
    },
    record: (event) => {
      const flushed = repository.flushPending();
      const status = repository.publishAfterBoundary(materialize(event));
      if (status !== 'published') console.error('[overlook] activity publication pending', event.eventType);
      if (status === 'published') enforceRetention(repository);
      if (flushed > 0 || status !== 'unavailable') onChanged();
    },
    recordMutation: (mutation, activity) => {
      let recorded = false;
      const result = repository.transaction(() => {
        const completed = mutation();
        const event = activity(completed);
        if (event !== undefined) {
          append(event);
          recorded = true;
        }
        return completed;
      });
      if (recorded) onChanged();
      return result;
    },
  };
}
