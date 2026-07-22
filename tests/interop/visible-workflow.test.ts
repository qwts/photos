import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedInteropWorkflow, interopPhaseLabel, interopRecoveryLabel } from '../../src/renderer/src/interop/visible-workflow.js';

describe('Transfer and Sync visible workflow', () => {
  test('starts blocked without inventing review or custody results', () => {
    const state = blockedInteropWorkflow('selection', 4);
    assert.equal(state.counts.total, 4);
    assert.equal(state.counts.eligible, 0);
    assert.equal(state.counts.acknowledged, 0);
    assert.equal(state.counts.finalized, 0);
    assert.equal(state.provider.state, 'disconnected');
    assert.equal(state.pairing, 'not-configured');
    assert.match(state.error?.message ?? '', /Eligibility has not been checked/);
  });

  test('uses the shared acknowledgement and recovery vocabulary', () => {
    assert.equal(interopPhaseLabel('awaiting-acknowledgement'), 'Awaiting verified acknowledgement');
    assert.equal(interopRecoveryLabel('auth-expired'), 'Reconnect');
    assert.equal(interopRecoveryLabel('partial-failure'), 'Resume');
    assert.equal(interopRecoveryLabel('wrong-key'), 'Import pairing again');
  });
});
