import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';

import { reloadWebContentsForLock, type ReloadableWebContents, type ReloadListener } from '../../src/main/crypto/renderer-lock-reload.js';

class FakeContents extends EventEmitter implements ReloadableWebContents {
  reloads = 0;

  constructor(private readonly destroyed = false) {
    super();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  override once(event: string, listener: ReloadListener): this {
    return super.once(event, listener);
  }

  override off(event: string, listener: ReloadListener): this {
    return super.off(event, listener);
  }

  reloadIgnoringCache(): void {
    this.reloads += 1;
  }
}

describe('renderer lock reload barrier (#311 review)', () => {
  test('waits for every live document and skips destroyed contents', async () => {
    const first = new FakeContents();
    const second = new FakeContents();
    const gone = new FakeContents(true);
    const reload = reloadWebContentsForLock([first, second, gone]);
    assert.equal(first.reloads, 1);
    assert.equal(second.reloads, 1);
    assert.equal(gone.reloads, 0);
    first.emit('did-finish-load');
    second.emit('destroyed');
    await reload;
    assert.equal(first.listenerCount('did-fail-load'), 0);
    assert.equal(second.listenerCount('did-finish-load'), 0);
  });

  test('rejects a failed lock-surface reload with an opaque non-secret error', async () => {
    const contents = new FakeContents();
    const reload = reloadWebContentsForLock([contents]);
    contents.emit('did-fail-load', {}, -6, 'file missing');
    await assert.rejects(reload, /locked renderer reload failed \(-6\): file missing/);
    assert.equal(contents.listenerCount('destroyed'), 0);
  });

  test('supports a themed navigation while preserving the lock reload barrier (#395 review)', async () => {
    const contents = new FakeContents();
    let navigations = 0;
    const reload = reloadWebContentsForLock([contents], (target) => {
      assert.equal(target.listenerCount('did-finish-load'), 1);
      navigations += 1;
    });
    assert.equal(contents.reloads, 0);
    assert.equal(navigations, 1);
    contents.emit('did-finish-load');
    await reload;
  });
});
