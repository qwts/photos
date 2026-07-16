import type { InteropHeader } from './contract.js';

type ReplayHeader = Pick<InteropHeader, 'messageId' | 'pairingId'>;

export class InteropReplayError extends Error {
  override readonly name = 'InteropReplayError';
}

export function interopReplayIdentity(header: ReplayHeader): string {
  return `${header.pairingId}:${header.messageId}`;
}

export class InteropReplayGuard {
  readonly #seen = new Set<string>();

  observe(header: ReplayHeader): void {
    const identity = interopReplayIdentity(header);
    if (this.#seen.has(identity)) throw new InteropReplayError('Interoperability message was already processed.');
    this.#seen.add(identity);
  }
}
