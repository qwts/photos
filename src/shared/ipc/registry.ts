import type { z } from 'zod';

import type { ChannelDefinition, EventDefinition } from './channels.js';

// Transport-agnostic wiring so the validation logic is unit-testable without
// Electron: preload passes ipcRenderer.invoke, main passes the handler, tests
// pass fakes. Both directions validate at the boundary — malformed traffic
// throws (rejects loudly) instead of crossing.

export type InvokeTransport = (channelName: string, request: unknown) => Promise<unknown>;

export type SubscribeTransport = (eventName: string, listener: (payload: unknown) => void) => () => void;

/** Renderer-side (preload) invoker: validates the request before it leaves
 * and the response before the renderer sees it. */
export function createInvoker<TRequest extends z.ZodType, TResponse extends z.ZodType>(
  channel: ChannelDefinition<TRequest, TResponse>,
  transport: InvokeTransport,
): (request: z.input<TRequest>) => Promise<z.output<TResponse>> {
  return async (request) => {
    const parsedRequest = channel.request.parse(request);
    const rawResponse = await transport(channel.name, parsedRequest);
    return channel.response.parse(rawResponse);
  };
}

/** Main-side handler wrapper: validates the incoming request before the
 * handler runs and the handler's response before it is sent back. */
export function wrapHandler<TRequest extends z.ZodType, TResponse extends z.ZodType>(
  channel: ChannelDefinition<TRequest, TResponse>,
  handler: (request: z.output<TRequest>) => Promise<z.output<TResponse>> | z.output<TResponse>,
): (rawRequest: unknown) => Promise<z.output<TResponse>> {
  return async (rawRequest) => {
    const request = channel.request.parse(rawRequest);
    const response = await handler(request);
    return channel.response.parse(response);
  };
}

/** Main-side event emitter: validates the payload before it is pushed. */
export function createEmitter<TPayload extends z.ZodType>(
  event: EventDefinition<TPayload>,
  send: (eventName: string, payload: unknown) => void,
): (payload: z.input<TPayload>) => void {
  return (payload) => {
    send(event.name, event.payload.parse(payload));
  };
}

/** Renderer-side (preload) subscriber: validates each payload before the
 * listener sees it. Returns an unsubscribe function. */
export function createSubscriber<TPayload extends z.ZodType>(
  event: EventDefinition<TPayload>,
  subscribe: SubscribeTransport,
): (listener: (payload: z.output<TPayload>) => void) => () => void {
  return (listener) =>
    subscribe(event.name, (payload) => {
      listener(event.payload.parse(payload));
    });
}
