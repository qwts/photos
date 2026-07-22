import { z } from 'zod';

import type { ChannelDefinition, EventDefinition } from './channels.js';
import { boardSchema } from '../moodboard/board.js';

// Moodboard persistence channels (#515 / #694). Boards are album-class
// organizational metadata; these validated channels are the only renderer↔main
// path (never raw ipcRenderer). The shared `boardSchema` validates both the
// saved payload and the loaded response, so a malformed board can never cross
// the bridge in either direction.
function channel<TRequest extends z.ZodType, TResponse extends z.ZodType>(
  name: string,
  request: TRequest,
  response: TResponse,
): ChannelDefinition<TRequest, TResponse> {
  return { name, request, response };
}

export const boardChannels = {
  boardList: channel('board:list', z.object({}), z.object({ boards: z.array(boardSchema) })),
  boardGet: channel('board:get', z.object({ boardId: z.string().min(1) }), z.object({ board: boardSchema.nullable() })),
  boardSave: channel('board:save', z.object({ board: boardSchema }), z.object({})),
  boardDelete: channel('board:delete', z.object({ boardId: z.string().min(1) }), z.object({})),
} as const;

function event<TPayload extends z.ZodType>(name: string, payload: TPayload): EventDefinition<TPayload> {
  return { name, payload };
}

export const boardEvents = {
  // Pushed after undo/redo rewrites a board's layout in main, so the open
  // canvas reloads instead of overwriting the reverted state (#695).
  boardsReload: event('board:reload', z.object({ boardId: z.string().min(1) })),
} as const;
