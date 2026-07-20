import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { destructiveActions } from '../../src/shared/destructive-actions.js';
import { TRASH_RETENTION_DAYS, trashDaysRemaining, trashRetentionLabel } from '../../src/shared/library/trash.js';

describe('ADR-0023 destructive action contract', () => {
  test('registry identifiers are unique and irreversible actions carry authorization and side effects', () => {
    const actions = Object.values(destructiveActions);
    assert.equal(new Set(actions.map((action) => action.id)).size, actions.length);
    for (const action of actions) {
      if (action.tier !== 'irreversible') continue;
      assert.ok('authorization' in action && action.authorization.length > 0);
      assert.ok('sideEffects' in action && action.sideEffects.length > 0);
      assert.match(action.label, /permanently/u);
    }
  });

  test('reversible and structural actions state what survives', () => {
    for (const action of Object.values(destructiveActions)) {
      if (action.tier === 'irreversible') continue;
      assert.ok('survival' in action && action.survival.length > 0);
    }
  });

  test('30-day retention rounds up and exposes the expiry day', () => {
    const now = Date.parse('2026-07-20T12:00:00.000Z');
    assert.equal(TRASH_RETENTION_DAYS, 30);
    assert.equal(trashDaysRemaining('2026-07-20T12:00:00.000Z', now), 30);
    assert.equal(trashDaysRemaining('2026-07-19T11:59:59.999Z', now), 29);
    assert.equal(trashRetentionLabel('2026-06-20T12:00:00.000Z', now), 'Deletes permanently today');
  });
});
