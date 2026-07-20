import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { lightboxStepForKey } from '../../src/renderer/src/state/lightbox-direction.js';

describe('lightbox visual arrow direction (#405, ADR-0020 §5)', () => {
  test('LTR follows sequence order while RTL reverses it', () => {
    assert.equal(lightboxStepForKey('ArrowLeft', 'ltr'), -1);
    assert.equal(lightboxStepForKey('ArrowRight', 'ltr'), 1);
    assert.equal(lightboxStepForKey('ArrowLeft', 'rtl'), 1);
    assert.equal(lightboxStepForKey('ArrowRight', 'rtl'), -1);
  });
});
