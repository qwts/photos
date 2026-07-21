import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { channels } from '../../src/shared/ipc/channels.js';
import { ORIGINAL_DELETE_AUTHORIZATION } from '../../src/shared/destructive-actions.js';
import { registerOriginalPolicyHandlersWith, type IpcHandlerRegistrar } from '../../src/main/library/original-policy-handlers.js';
import { createPurgeRepository } from '../../src/main/library/purge-repository.js';
import type { LibraryService } from '../../src/main/library/library-service.js';
import type { OriginalDeletionService } from '../../src/main/library/original-deletion-service.js';
import type { PhotosRepository } from '../../src/main/db/photos-repository.js';

const CHALLENGE_ID = '11111111-1111-4111-8111-111111111111';

describe('Original policy wiring (#482)', () => {
  test('registers validated IPC adapters for classification and the deletion ceremony', async () => {
    const handlers = new Map<string, (event: unknown, request: unknown) => unknown>();
    const registrar: IpcHandlerRegistrar = {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
    };
    const cancelled: string[] = [];
    const library = {
      setOriginal: () => ({ changed: 1, unchanged: 0, missing: 0, pendingCount: 2, changedPhotoIds: ['A'] }),
    } as unknown as LibraryService;
    const service = {
      preflight: () => ({
        challengeId: CHALLENGE_ID,
        count: 1,
        protected: 1,
        fileName: 'A.jpg',
        passwordRequired: true,
        expiresAt: '2026-07-21T12:02:00.000Z',
      }),
      authorize: (_challengeId: string, password: string) =>
        Promise.resolve(password === 'correct' ? { ok: true as const } : { ok: false as const, reason: 'wrong-password' as const }),
      commit: () => Promise.resolve({ purged: 1, skipped: 0, protected: 0, remoteFailures: 0 }),
      cancel: (challengeId: string) => cancelled.push(challengeId),
    } as unknown as OriginalDeletionService;

    registerOriginalPolicyHandlersWith(
      () => library,
      () => service,
      registrar,
    );
    const invoke = (channel: string, request: unknown): Promise<unknown> => Promise.resolve(handlers.get(channel)?.({}, request));

    assert.deepEqual(await invoke(channels.librarySetOriginal.name, { photoIds: ['A'], isOriginal: true }), {
      changed: 1,
      unchanged: 0,
      missing: 0,
      pendingCount: 2,
    });
    assert.deepEqual(await invoke(channels.libraryOriginalDeletePreflight.name, { photoIds: ['A'] }), {
      challengeId: CHALLENGE_ID,
      count: 1,
      protected: 1,
      fileName: 'A.jpg',
      passwordRequired: true,
      expiresAt: '2026-07-21T12:02:00.000Z',
    });
    assert.deepEqual(await invoke(channels.libraryOriginalDeleteAuthorize.name, { challengeId: CHALLENGE_ID, password: 'wrong' }), {
      ok: false,
      reason: 'wrong-password',
      retryAfterMs: 0,
    });
    assert.deepEqual(await invoke(channels.libraryOriginalDeleteAuthorize.name, { challengeId: CHALLENGE_ID, password: 'correct' }), {
      ok: true,
      reason: null,
      retryAfterMs: 0,
    });
    assert.deepEqual(
      await invoke(channels.libraryOriginalDeleteCommit.name, {
        challengeId: CHALLENGE_ID,
        authorization: ORIGINAL_DELETE_AUTHORIZATION,
      }),
      {
        purged: 1,
        skipped: 0,
        protected: 0,
        remoteFailures: 0,
      },
    );
    assert.deepEqual(await invoke(channels.libraryOriginalDeleteCancel.name, { challengeId: CHALLENGE_ID }), {});
    assert.deepEqual(cancelled, [CHALLENGE_ID]);
  });

  test('projects the purge repository capability without changing behavior', () => {
    const calls: string[] = [];
    const repo = {
      getDeleted: (id: string) => (calls.push(`deleted:${id}`), undefined),
      get: (id: string) => (calls.push(`any:${id}`), undefined),
      purgeRow: (id: string) => calls.push(`purge:${id}`),
      purgeRowAuthorized: (id: string) => calls.push(`authorized:${id}`),
      countAnyByContentHash: (hash: string) => (calls.push(`count:${hash}`), 2),
      expiredDeleted: (cutoff: string) => (calls.push(`expired:${cutoff}`), ['A']),
    } as unknown as PhotosRepository;
    const projected = createPurgeRepository(repo);

    assert.equal(projected.getDeleted('A'), undefined);
    assert.equal(projected.getAny('A'), undefined);
    projected.purgeRow('A');
    projected.purgeRowAuthorized('A');
    assert.equal(projected.countAnyByContentHash('hash'), 2);
    assert.deepEqual(projected.expiredDeleted('cutoff'), ['A']);
    assert.deepEqual(calls, ['deleted:A', 'any:A', 'purge:A', 'authorized:A', 'count:hash', 'expired:cutoff']);
  });
});
