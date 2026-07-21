import { z } from 'zod';

import type { InteropObjectStore } from './transport.js';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const manifestPattern = new RegExp(`^pairings/(${uuid})/transfers/(${uuid})/objects/(.+)\\.manifest\\.json$`, 'iu');
const messagePattern = new RegExp(`^messages/outbox/([0-9]{12})-(${uuid})\\.json\\.aesgcm$`, 'iu');
const acknowledgementPattern = new RegExp(`^messages/acknowledgements/[0-9]{12}-${uuid}\\.json\\.aesgcm$`, 'iu');
const blobPattern = new RegExp(`^blobs/(${uuid})/original\\.bin\\.aesgcm$`, 'iu');
const uuidSchema = z.string().uuid();

export interface DiscoveredMoveMessage {
  readonly kind: 'message';
  readonly providerPath: string;
  readonly transferId: string;
  readonly logicalPath: string;
  readonly sequence: number;
  readonly messageId: string;
}

export interface DiscoveredMoveBlob {
  readonly kind: 'original-blob';
  readonly providerPath: string;
  readonly transferId: string;
  readonly logicalPath: string;
  readonly recordInteropId: string;
}

export type DiscoveredMoveObject = DiscoveredMoveMessage | DiscoveredMoveBlob;

export interface DiscoveredMoveTransfer {
  readonly transferId: string;
  readonly messages: readonly DiscoveredMoveMessage[];
  readonly originals: readonly DiscoveredMoveBlob[];
}

export class InboundMoveDiscoveryError extends Error {
  override readonly name = 'InboundMoveDiscoveryError';
}

export function parseInboundMoveManifestPath(pairingIdInput: string, providerPath: string): DiscoveredMoveObject | null {
  const pairingId = uuidSchema.parse(pairingIdInput);
  const manifest = manifestPattern.exec(providerPath);
  if (manifest === null) return null;
  const [, pathPairingId, transferIdInput, logicalPath] = manifest;
  if (pathPairingId?.toLowerCase() !== pairingId.toLowerCase() || transferIdInput === undefined || logicalPath === undefined) {
    throw new InboundMoveDiscoveryError('Incoming Move object is outside the unlocked pairing scope.');
  }
  const transferId = uuidSchema.parse(transferIdInput);
  const message = messagePattern.exec(logicalPath);
  if (message !== null) {
    const sequence = Number(message[1]);
    const messageId = uuidSchema.parse(message[2]);
    if (!Number.isSafeInteger(sequence) || sequence <= 0) {
      throw new InboundMoveDiscoveryError('Incoming Move message sequence is invalid.');
    }
    return { kind: 'message', providerPath, transferId, logicalPath, sequence, messageId };
  }
  const blob = blobPattern.exec(logicalPath);
  if (blob !== null) {
    return {
      kind: 'original-blob',
      providerPath,
      transferId,
      logicalPath,
      recordInteropId: uuidSchema.parse(blob[1]),
    };
  }
  if (acknowledgementPattern.test(logicalPath)) return null;
  throw new InboundMoveDiscoveryError('Incoming Move manifest has an unsupported canonical path.');
}

export class InboundMoveDiscovery {
  constructor(private readonly store: InteropObjectStore) {}

  async discover(pairingIdInput: string): Promise<readonly DiscoveredMoveTransfer[]> {
    const pairingId = uuidSchema.parse(pairingIdInput);
    const prefix = `pairings/${pairingId}/transfers`;
    const objects: DiscoveredMoveObject[] = [];
    const cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = await this.store.list(prefix, cursor);
      for (const entry of page.entries) {
        const parsed = parseInboundMoveManifestPath(pairingId, entry.path);
        if (parsed !== null) objects.push(parsed);
      }
      cursor = page.nextCursor;
      if (cursor !== null && cursors.has(cursor)) throw new InboundMoveDiscoveryError('Incoming Move pagination cursor was replayed.');
      if (cursor !== null) cursors.add(cursor);
    } while (cursor !== null);

    const grouped = new Map<string, DiscoveredMoveObject[]>();
    for (const object of objects) grouped.set(object.transferId, [...(grouped.get(object.transferId) ?? []), object]);
    return [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([transferId, entries]) => this.validateTransfer(transferId, entries));
  }

  private validateTransfer(transferId: string, objects: readonly DiscoveredMoveObject[]): DiscoveredMoveTransfer {
    const messages = objects
      .filter((object): object is DiscoveredMoveMessage => object.kind === 'message')
      .sort((left, right) => left.sequence - right.sequence || left.messageId.localeCompare(right.messageId));
    const originals = objects
      .filter((object): object is DiscoveredMoveBlob => object.kind === 'original-blob')
      .sort((left, right) => left.recordInteropId.localeCompare(right.recordInteropId));
    const sequences = new Set<number>();
    const messageIds = new Set<string>();
    for (const [index, message] of messages.entries()) {
      if (sequences.has(message.sequence)) throw new InboundMoveDiscoveryError('Incoming Move reuses a message sequence.');
      if (messageIds.has(message.messageId)) throw new InboundMoveDiscoveryError('Incoming Move reuses a message identity.');
      if (message.sequence !== index + 1) throw new InboundMoveDiscoveryError('Incoming Move message sequence is incomplete.');
      sequences.add(message.sequence);
      messageIds.add(message.messageId);
    }
    if (new Set(originals.map((blob) => blob.recordInteropId)).size !== originals.length) {
      throw new InboundMoveDiscoveryError('Incoming Move publishes multiple originals for one record.');
    }
    return { transferId, messages, originals };
  }
}
