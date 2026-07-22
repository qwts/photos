import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { InboundMoveController, type InboundMoveControllerOptions } from '../../src/main/interop/inbound-move-controller.js';
import type { InboundAcceptance } from '../../src/main/interop/inbound-photo-importer.js';
import type {
  InboundMoveRunControl,
  IncomingMoveBatch,
  IncomingMoveItem,
  IncomingMoveRunResult,
} from '../../src/main/interop/inbound-move-runtime.js';
import type { InteropPairingState, InteropProviderState } from '../../src/shared/interop/runtime-state.js';

const transferId = 'fc0b0b81-114f-480b-8ff6-a1531e57b605';
const secondTransferId = '2107cfbc-3d4d-4e32-9150-8378e42820d9';
const interopId = '665fc4f8-8287-42db-b195-f7828d530da8';
const secondInteropId = '3fe6f1f5-c8c2-4ded-81a2-63fc8b7e9257';

const item = {
  request: {
    payload: {
      record: {
        identity: { interopId },
        title: 'Saved mountain',
        original: { state: 'metadata-only' },
      },
    },
  },
  reviewCategory: 'metadata-only',
  acknowledged: false,
  outcome: 'pending',
  reason: null,
} as unknown as IncomingMoveItem;

const batch = {
  transferId,
  items: [item],
  counts: {
    total: 1,
    eligible: 0,
    duplicate: 0,
    conflict: 0,
    metadataOnly: 1,
    unsupported: 0,
    skipped: 0,
    failed: 0,
    acknowledged: 0,
    finalized: 0,
  },
} satisfies IncomingMoveBatch;

const accepted: InboundAcceptance = {
  accepted: true,
  reviewCategory: 'metadata-only',
  targetLocalId: null,
  metadataPersisted: true,
  originalVerification: 'metadata-only',
  photoChanged: false,
  reason: 'Metadata copied; the source original was retained.',
};

function pendingBatch(id: string, recordId: string): IncomingMoveBatch {
  return {
    ...batch,
    transferId: id,
    items: [
      {
        ...item,
        request: {
          ...item.request,
          payload: {
            ...item.request.payload,
            record: {
              ...item.request.payload.record,
              identity: { ...item.request.payload.record.identity, interopId: recordId },
            },
          },
        },
      },
    ],
  };
}

function harness(runtime: InboundMoveControllerOptions['runtime']): {
  controller: InboundMoveController;
  passwordRef: () => Uint8Array | null;
  events: string[];
} {
  let pairing: InteropPairingState = {
    status: 'locked',
    pairingId: 'd9afc67d-781c-4e8b-a396-bcf8c4fc9739',
    keyId: 'interop:81ad4f06-0ecf-4a24-8c65-fcd34075cf15',
    createdAt: '2026-07-21T12:00:00.000Z',
  };
  let password: Uint8Array | null = null;
  const provider: InteropProviderState = { provider: 'pcloud', status: 'connected', busy: false };
  const events: string[] = [];
  const controller = new InboundMoveController({
    runtime,
    pairing: {
      state: () => pairing,
      replace: () => pairing,
      unlock: (bytes) => {
        password = bytes;
        pairing = { ...pairing, status: 'unlocked' };
        return Promise.resolve(pairing);
      },
    },
    provider: {
      state: () => Promise.resolve(provider),
      connect: () => Promise.resolve({ ok: true, reason: null }),
      disconnect: () => ({ ok: true, reason: null }),
    },
    pickPairingBundle: () => Promise.resolve(null),
    statusChanged: (status) => events.push(status.progress.phase),
  });
  return { controller, passwordRef: () => password, events };
}

describe('InboundMoveController (#676)', () => {
  test('unlocks through one-shot bytes and zeroizes them before returning status', async () => {
    const { controller, passwordRef } = harness(() => ({
      refresh: () => Promise.resolve([]),
      start: () => Promise.resolve({ transferId, accepted: 0, retained: 0, changedPhotoIds: [] }),
    }));

    const status = await controller.unlockPairing('correct horse battery staple');

    assert.equal(status.pairing.status, 'unlocked');
    assert.ok(passwordRef()?.every((byte) => byte === 0));
    assert.equal('password' in status, false);
  });

  test('publishes real preview counts and item outcomes through completion', async () => {
    const runtime = {
      refresh: () => Promise.resolve([batch]),
      start: async (_id: string, control: InboundMoveRunControl = {}): Promise<IncomingMoveRunResult> => {
        await control.beforeItem?.(item, 0, 1);
        await control.itemCompleted?.(item, accepted, 0, 1);
        return { transferId, accepted: 1, retained: 0, changedPhotoIds: [] };
      },
    };
    const { controller, events } = harness(() => runtime);

    const preview = await controller.refresh();
    assert.equal(preview.batches[0]?.counts.metadataOnly, 1);
    assert.equal(preview.batches[0]?.items[0]?.label, 'Saved mountain');
    assert.equal((await controller.start(transferId)).progress.phase, 'transferring');
    await controller.drain();

    const completed = await controller.status();
    assert.deepEqual(completed.progress, { transferId, phase: 'completed', processed: 1, total: 1, accepted: 1, retained: 0 });
    assert.equal(completed.batches[0]?.items[0]?.outcome, 'accepted');
    assert.ok(events.includes('reviewing'));
    assert.ok(events.includes('completed'));
  });

  test('advances to every discovered transfer instead of pinning the first batch', async () => {
    const batches = [pendingBatch(transferId, interopId), pendingBatch(secondTransferId, secondInteropId)];
    const runtime = {
      refresh: () => Promise.resolve(batches),
      start: async (id: string, control: InboundMoveRunControl = {}): Promise<IncomingMoveRunResult> => {
        const selected = batches.find((candidate) => candidate.transferId === id);
        const selectedItem = selected?.items[0];
        if (selectedItem === undefined) throw new Error('Unknown transfer.');
        await control.beforeItem?.(selectedItem, 0, 1);
        await control.itemCompleted?.(selectedItem, accepted, 0, 1);
        return { transferId: id, accepted: 1, retained: 0, changedPhotoIds: [] };
      },
    };
    const { controller } = harness(() => runtime);

    await controller.refresh();
    await controller.start(transferId);
    await controller.drain();
    const next = await controller.status();
    assert.equal(next.selectedTransferId, secondTransferId);
    assert.equal(next.progress.phase, 'reviewing');

    await controller.start(secondTransferId);
    await controller.drain();
    const completed = await controller.status();
    assert.equal(completed.selectedTransferId, secondTransferId);
    assert.equal(completed.progress.phase, 'completed');
  });

  test('refresh preserves durable item outcomes and acknowledgement counts', async () => {
    const durable = {
      ...batch,
      items: [{ ...item, outcome: 'accepted' as const }],
      counts: { ...batch.counts, acknowledged: 1 },
    };
    const { controller } = harness(() => ({
      refresh: () => Promise.resolve([durable]),
      start: () => Promise.resolve({ transferId, accepted: 1, retained: 0, changedPhotoIds: [] }),
    }));

    const status = await controller.refresh();
    assert.equal(status.batches[0]?.counts.acknowledged, 1);
    assert.equal(status.batches[0]?.items[0]?.outcome, 'accepted');
    assert.deepEqual(status.progress, { transferId, phase: 'completed', processed: 1, total: 1, accepted: 1, retained: 0 });
  });

  test('pause blocks the next item boundary and cancel drains to a resumable state', async () => {
    let releaseStart: (() => void) | undefined;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const runtime = {
      refresh: () => Promise.resolve([batch]),
      start: async (_id: string, control: InboundMoveRunControl = {}): Promise<IncomingMoveRunResult> => {
        await startGate;
        await control.beforeItem?.(item, 0, 1);
        return { transferId, accepted: 0, retained: 0, changedPhotoIds: [] };
      },
    };
    const { controller } = harness(() => runtime);
    await controller.refresh();
    await controller.start(transferId);
    assert.equal((await controller.pause()).progress.phase, 'paused');
    releaseStart?.();
    await Promise.resolve();
    await controller.cancel();
    await controller.drain();

    const cancelled = await controller.status();
    assert.equal(cancelled.progress.phase, 'cancelled');
    assert.equal(cancelled.error?.code, 'interrupted');
    assert.equal(cancelled.error?.retryable, true);
  });
});
