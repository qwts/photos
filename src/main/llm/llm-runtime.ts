import path from 'node:path';

import { app } from 'electron';

import { pickSafeStorage } from '../crypto/safe-storage-runtime.js';
import { getSettingsStore } from '../settings/settings-runtime.js';
import { LlmAuthStore } from './auth-store.js';
import { LlmFacade } from './facade.js';
import { LlmProviderRuntime } from './runtime.js';

// Process-wide LLM provider custody (ADR-0018 §7, #393), a singleton in the
// diagnostics/settings-runtime mould. Keys live under userData/llm-auth —
// profile-global, not library content — so the facade is built once and
// survives library switches. The selected provider is read live from
// profile-scoped settings on each request.

let llmFacade: LlmFacade | undefined;

export function getLlmFacade(): LlmFacade {
  llmFacade ??= new LlmFacade({
    runtime: new LlmProviderRuntime({
      authStore: new LlmAuthStore({
        safeStorage: pickSafeStorage(),
        authRootDir: path.join(app.getPath('userData'), 'llm-auth'),
      }),
    }),
    selectedProviderId: () => getSettingsStore().get().llmProviderId,
  });
  return llmFacade;
}
