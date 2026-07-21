import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

import type { ActivityAppend, ActivityEventType, ActivityOutcome, ActivityPage } from '../../shared/activity/types.js';
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

export function createActivityFacade(db: BetterSqlite3.Database, onChanged: () => void): ActivityFacade {
  const repository = new ActivityRepository(db);
  const append = (event: ActivityDraft): void => {
    const operationId = ulid();
    repository.append({
      ...event,
      eventId: ulid(),
      operationId,
      rootCorrelationId: operationId,
      occurredAt: new Date().toISOString(),
    });
  };
  return {
    page: (limit, cursor) => {
      const pruned = repository.prune(new Date());
      if (pruned > 0) {
        append({ eventType: 'activity.pruned', outcome: 'succeeded', payload: { count: pruned } });
        onChanged();
      }
      return repository.page(limit, cursor);
    },
    record: (event) => {
      append(event);
      onChanged();
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
