import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { channels, events } from '../../src/shared/ipc/channels.js';
import { createEmitter, createInvoker, createSubscriber, wrapHandler } from '../../src/shared/ipc/registry.js';

describe('channel registry', () => {
  test('channel and event names are unique', () => {
    const names = [...Object.values(channels).map((c) => c.name), ...Object.values(events).map((e) => e.name)];
    assert.equal(new Set(names).size, names.length);
  });
});

describe('createInvoker', () => {
  test('round-trips a valid request through the transport', async () => {
    const calls: Array<{ name: string; request: unknown }> = [];
    const invoke = createInvoker(channels.ping, (name, request) => {
      calls.push({ name, request });
      return Promise.resolve({ echoed: 'hello' });
    });

    const response = await invoke({ message: 'hello' });

    assert.deepEqual(response, { echoed: 'hello' });
    assert.deepEqual(calls, [{ name: 'demo:ping', request: { message: 'hello' } }]);
  });

  test('rejects an invalid request before it reaches the transport', async () => {
    let transportCalled = false;
    const invoke = createInvoker(channels.ping, () => {
      transportCalled = true;
      return Promise.resolve({ echoed: 'x' });
    });

    // Cast simulates a caller sidestepping the compile-time types.
    // type-coverage:ignore-next-line
    await assert.rejects(invoke({ message: 42 } as unknown as { message: string }));
    assert.equal(transportCalled, false);
  });

  test('rejects a malformed response from the transport', async () => {
    const invoke = createInvoker(channels.ping, () => Promise.resolve({ wrong: true }));
    await assert.rejects(invoke({ message: 'hello' }));
  });
});

describe('wrapHandler', () => {
  test('validates the request, runs the handler, validates the response', async () => {
    const handler = wrapHandler(channels.ping, ({ message }) => ({ echoed: message }));
    assert.deepEqual(await handler({ message: 'hi' }), { echoed: 'hi' });
  });

  test('rejects a malformed request without running the handler', async () => {
    let handlerRan = false;
    const handler = wrapHandler(channels.ping, ({ message }) => {
      handlerRan = true;
      return { echoed: message };
    });

    await assert.rejects(handler({ nope: true }));
    assert.equal(handlerRan, false);
  });

  test('rejects a handler response that violates the schema', async () => {
    // type-coverage:ignore-next-line
    const handler = wrapHandler(channels.ping, () => ({ echoed: 7 }) as unknown as { echoed: string });
    await assert.rejects(handler({ message: 'hi' }));
  });
});

describe('events', () => {
  test('emitter validates and sends the payload', () => {
    const sent: Array<{ name: string; payload: unknown }> = [];
    const emit = createEmitter(events.focusChanged, (name, payload) => {
      sent.push({ name, payload });
    });

    emit({ focused: true });

    assert.deepEqual(sent, [{ name: 'window:focus-changed', payload: { focused: true } }]);
  });

  test('emitter throws on a malformed payload', () => {
    const emit = createEmitter(events.focusChanged, () => {});
    // type-coverage:ignore-next-line
    assert.throws(() => emit({ focused: 'yes' } as unknown as { focused: boolean }));
  });

  test('subscriber delivers validated payloads and unsubscribes', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const subscribe = createSubscriber(events.focusChanged, (name, listener) => {
      listeners.set(name, listener);
      return () => listeners.delete(name);
    });

    const received: unknown[] = [];
    const unsubscribe = subscribe((payload) => received.push(payload));
    listeners.get('window:focus-changed')?.({ focused: false });
    assert.deepEqual(received, [{ focused: false }]);

    unsubscribe();
    assert.equal(listeners.size, 0);
  });

  test('subscriber throws on a malformed payload instead of delivering it', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const subscribe = createSubscriber(events.focusChanged, (name, listener) => {
      listeners.set(name, listener);
      return () => listeners.delete(name);
    });

    const received: unknown[] = [];
    subscribe((payload) => received.push(payload));

    assert.throws(() => listeners.get('window:focus-changed')?.({ focused: 'broken' }));
    assert.equal(received.length, 0);
  });
});
