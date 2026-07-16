import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { interopEnvelopeSchema } from '../../src/shared/interop/messages.js';
import { analyzeSyncRecords, resolveSyncConflicts } from '../../src/shared/interop/sync-resolution.js';

function fixtureRecord() {
  const input = JSON.parse(readFileSync('design/handoff/contracts/v1/fixtures/round-trip-record-message.json', 'utf8')) as unknown;
  const envelope = interopEnvelopeSchema.parse(input);
  assert.equal(envelope.payload.kind, 'record');
  if (envelope.payload.kind !== 'record') throw new Error('record fixture expected');
  return envelope.payload.record;
}

describe('Sync record resolution', () => {
  test('converges to the same field winners independent of delivery order', () => {
    const base = fixtureRecord();
    const imageTrail = {
      ...base,
      title: 'Image Trail title',
      label: 'shared',
      revision: { imageTrail: 3, overlook: 1 },
      fieldRevisions: {
        ...base.fieldRevisions,
        title: { imageTrail: 3, overlook: 1 },
        label: { imageTrail: 2, overlook: 1 },
      },
    };
    const overlook = {
      ...base,
      title: 'old title',
      label: 'Overlook label',
      revision: { imageTrail: 2, overlook: 4 },
      fieldRevisions: {
        ...base.fieldRevisions,
        title: { imageTrail: 2, overlook: 1 },
        label: { imageTrail: 2, overlook: 4 },
      },
    };

    const analysis = analyzeSyncRecords(imageTrail, overlook);
    assert.equal(analysis.category, 'eligible');
    assert.equal(analysis.merged.title, 'Image Trail title');
    assert.equal(analysis.merged.label, 'Overlook label');
    assert.deepEqual(analysis.merged.revision, { imageTrail: 3, overlook: 4 });
    assert.deepEqual(analyzeSyncRecords(imageTrail, overlook), analysis);
  });

  test('requires per-field decisions and models keep-both as an explicit second apply', () => {
    const base = fixtureRecord();
    const imageTrail = {
      ...base,
      title: 'Image Trail title',
      revision: { imageTrail: 3, overlook: 1 },
      fieldRevisions: { ...base.fieldRevisions, title: { imageTrail: 3, overlook: 1 } },
    };
    const overlook = {
      ...base,
      title: 'Overlook title',
      revision: { imageTrail: 1, overlook: 3 },
      fieldRevisions: { ...base.fieldRevisions, title: { imageTrail: 1, overlook: 3 } },
    };
    const analysis = analyzeSyncRecords(imageTrail, overlook);
    assert.equal(analysis.category, 'conflict');
    assert.deepEqual(
      analysis.conflicts.map(({ field }) => field),
      ['title'],
    );
    assert.throws(() => resolveSyncConflicts(analysis, imageTrail, overlook, {}), /requires an explicit decision/u);

    const outcome = resolveSyncConflicts(analysis, imageTrail, overlook, { title: 'keep-both' });
    assert.equal(outcome.primary.title, 'Image Trail title');
    assert.equal(outcome.secondary?.title, 'Overlook title');
  });

  test('never silently applies a newer tombstone', () => {
    const imageTrail = fixtureRecord();
    const overlook = {
      ...imageTrail,
      deletedAt: '2026-07-16T18:00:00.000Z',
      revision: { imageTrail: imageTrail.revision.imageTrail, overlook: imageTrail.revision.overlook + 1 },
      fieldRevisions: {
        ...imageTrail.fieldRevisions,
        deleted: { imageTrail: imageTrail.revision.imageTrail, overlook: imageTrail.revision.overlook + 1 },
      },
    };
    assert.equal(analyzeSyncRecords(imageTrail, overlook).category, 'delete-review');
  });
});
