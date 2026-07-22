import { ipcMain } from 'electron';

import { llmChannels } from '../../shared/ipc/llm-channels.js';
import { wrapHandler } from '../../shared/ipc/registry.js';
import type { LlmFacade } from './facade.js';

// IPC handlers for the opt-in LLM assistant (ADR-0018 §7, #393). This slice
// wires provider custody only — list / connect / disconnect — backed by
// LlmFacade. The Q&A channels (estimate/ask/spend) and the llm:inflight event
// land with the Q&A slice. Provider custody is profile-scoped (keys live under
// userData, outside any library), so these handlers do not gate on content
// access. The facade returns `{ ok, reason }` for expected failures; only an
// unexpected throw becomes the registry's detail-free error envelope.

export function registerLlmHandlers(getFacade: () => LlmFacade): void {
  ipcMain.handle(llmChannels.llmProviders.name, (_event, request: unknown) =>
    wrapHandler(llmChannels.llmProviders, () => getFacade().providers())(request),
  );
  ipcMain.handle(llmChannels.llmConnect.name, (_event, request: unknown) =>
    wrapHandler(llmChannels.llmConnect, ({ providerId, apiKey }) => getFacade().connect(providerId, apiKey))(request),
  );
  ipcMain.handle(llmChannels.llmDisconnect.name, (_event, request: unknown) =>
    wrapHandler(llmChannels.llmDisconnect, ({ providerId }) => getFacade().disconnect(providerId))(request),
  );
}
