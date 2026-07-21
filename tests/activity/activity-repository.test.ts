import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { ActivityRepository } from '../../src/main/activity/activity-repository.js';
import { openLibraryDatabase } from '../../src/main/db/database.js';

function world(policy = { maxEvents: 100, maxAgeMs: 1_000_000, maxPayloadBytes: 10_000 }) {
  const db = openLibraryDatabase({
    path: join(mkdtempSync(join(tmpdir(), 'overlook-activity-')), 'library.db'),
    dbKey: randomBytes(32),
  });
  return { db, repo: new ActivityRepository(db, policy) };
}

function append(repo: ActivityRepository, id: string, occurredAt = '2026-07-20T00:00:00.000Z') {
  return repo.append({
    eventId: `event-${id}`,
    operationId: `operation-${id}`,
    eventType: 'photo.favorite-changed',
    occurredAt,
    entityIds: [`photo-${id}`],
    outcome: 'succeeded',
    payload: { favorite: true },
  });
}

describe('ActivityRepository (#614, ADR-0025)', () => {
  test('orders and cursor-pages append-only events across restart', () => {
    const { db, repo } = world();
    append(repo, 'a');
    append(repo, 'b');
    append(repo, 'c');
    const first = repo.page(2);
    assert.deepEqual(
      first.events.map((event) => event.eventId),
      ['event-c', 'event-b'],
    );
    assert.notEqual(first.nextCursor, null);
    const reopened = new ActivityRepository(db);
    assert.deepEqual(
      reopened.page(2, first.nextCursor ?? undefined).events.map((event) => event.eventId),
      ['event-a'],
    );
    db.close();
  });

  test('returns exact retries and rejects operation identity reuse with changed content', () => {
    const { db, repo } = world();
    const event = append(repo, 'same');
    assert.equal(append(repo, 'same').sequence, event.sequence);
    assert.throws(
      () =>
        repo.append({
          eventId: 'event-different',
          operationId: 'operation-same',
          eventType: 'photo.favorite-changed',
          occurredAt: '2026-07-20T00:00:00.000Z',
          entityIds: ['photo-same'],
          outcome: 'succeeded',
          payload: { favorite: false },
        }),
      /reused with different content/,
    );
    db.close();
  });

  test('prunes by age/count/bytes without removing an active retention hold', () => {
    const { db, repo } = world({ maxEvents: 2, maxAgeMs: 1_000, maxPayloadBytes: 40 });
    const held = append(repo, 'held', '2026-07-20T00:00:00.000Z');
    repo.hold(held.eventId, 'undo-held', '2026-07-20T01:00:00.000Z');
    append(repo, 'middle', '2026-07-20T00:00:01.000Z');
    append(repo, 'new', '2026-07-20T00:00:02.000Z');
    assert.equal(repo.prune(new Date('2026-07-20T00:00:02.500Z')), 1);
    assert.deepEqual(
      repo.page(10).events.map((event) => event.eventId),
      ['event-new', 'event-held'],
    );
    repo.releaseHold(held.eventId, 'undo-held');
    assert.equal(repo.prune(new Date('2026-07-20T00:00:03.000Z')), 1);
    db.close();
  });
});
