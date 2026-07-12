import { z } from 'zod';

// Central IPC contract registry: every renderer↔main channel and main→renderer
// event is declared here with request/response (or payload) schemas. Main
// registers handlers and preload exposes invokers for exactly this set —
// nothing else crosses the process boundary (#49).

export interface ChannelDefinition<TRequest extends z.ZodType, TResponse extends z.ZodType> {
  readonly name: string;
  readonly request: TRequest;
  readonly response: TResponse;
}

export interface EventDefinition<TPayload extends z.ZodType> {
  readonly name: string;
  readonly payload: TPayload;
}

function defineChannel<TRequest extends z.ZodType, TResponse extends z.ZodType>(
  name: string,
  request: TRequest,
  response: TResponse,
): ChannelDefinition<TRequest, TResponse> {
  return { name, request, response };
}

function defineEvent<TPayload extends z.ZodType>(name: string, payload: TPayload): EventDefinition<TPayload> {
  return { name, payload };
}

export const channels = {
  // Demo round-trip channel proving the registry under test; real domain
  // channels (library, import, backup, settings) arrive with their epics.
  ping: defineChannel('demo:ping', z.object({ message: z.string() }), z.object({ echoed: z.string() })),
  // Frameless-window chrome (#50): Windows/Linux draw custom controls, so the
  // renderer drives the window over IPC; mac uses native traffic lights.
  getPlatform: defineChannel('app:get-platform', z.object({}), z.object({ platform: z.string() })),
  windowMinimize: defineChannel('window:minimize', z.object({}), z.object({})),
  windowToggleMaximize: defineChannel('window:toggle-maximize', z.object({}), z.object({ maximized: z.boolean() })),
  windowClose: defineChannel('window:close', z.object({}), z.object({})),
} as const;

export const events = {
  // Main pushes window focus state; also the reference implementation of the
  // main→renderer event pattern (progress events, settings changes later).
  focusChanged: defineEvent('window:focus-changed', z.object({ focused: z.boolean() })),
} as const;

export type PingRequest = z.output<typeof channels.ping.request>;
export type PingResponse = z.output<typeof channels.ping.response>;
export type FocusChangedPayload = z.output<typeof events.focusChanged.payload>;
