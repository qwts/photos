import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describePhoto, type Photo } from '../src/shared/photo.js';

test('describePhoto renders title and id', () => {
  const photo: Photo = { id: 'p1', title: 'Sunset' };
  assert.equal(describePhoto(photo), 'Sunset (p1)');
});
