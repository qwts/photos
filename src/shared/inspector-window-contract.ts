import { z } from 'zod';

export const inspectorWindowStateSchema = z.object({
  photoId: z.string().nullable(),
  selectionPosition: z.object({ index: z.number().int().nonnegative(), count: z.number().int().positive() }).nullable(),
});

const empty = z.object({});
const step = z.object({ delta: z.union([z.literal(-1), z.literal(1)]) });

export const inspectorWindowChannels = {
  inspectorWindowOpen: { name: 'inspector-window:open', request: inspectorWindowStateSchema, response: empty },
  inspectorWindowUpdate: { name: 'inspector-window:update', request: inspectorWindowStateSchema, response: empty },
  inspectorWindowClose: { name: 'inspector-window:close', request: empty, response: empty },
  inspectorWindowStep: { name: 'inspector-window:step', request: step, response: empty },
  inspectorWindowSnapshot: { name: 'inspector-window:snapshot', request: empty, response: inspectorWindowStateSchema },
} as const;

export const windowEvents = {
  focusChanged: { name: 'window:focus-changed', payload: z.object({ focused: z.boolean() }) },
  inspectorWindowChanged: { name: 'inspector-window:changed', payload: inspectorWindowStateSchema },
  inspectorWindowClosed: { name: 'inspector-window:closed', payload: empty },
  inspectorWindowStepRequested: { name: 'inspector-window:step-requested', payload: step },
} as const;

export type InspectorWindowState = z.output<typeof inspectorWindowStateSchema>;
