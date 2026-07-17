import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SafeStorageLike } from '../crypto/keystore.js';
import { deserializeDiagnosticEvent, diagnosticEventIdSchema, serializeDiagnosticEvent, type DiagnosticEvent } from './event-contract.js';

const REPORT_SUFFIX = '.diagnostic';
const DEFAULT_MAX_REPORTS = 50;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class DiagnosticsCustodyError extends Error {
  override readonly name = 'DiagnosticsCustodyError';
}

export interface DiagnosticsQueueOptions {
  readonly dataDir: string;
  readonly safeStorage: SafeStorageLike;
  readonly now?: () => number;
  readonly maxReports?: number;
  readonly maxBytes?: number;
  readonly maxAgeMs?: number;
}

export interface QueuedDiagnostic {
  readonly event: DiagnosticEvent;
  /** Exact allowlisted JSON that inspection, export, and upload share. */
  readonly payload: string;
  readonly encryptedBytes: number;
}

export class DiagnosticsQueue {
  private readonly dataDir: string;
  private readonly safeStorage: SafeStorageLike;
  private readonly now: () => number;
  private readonly maxReports: number;
  private readonly maxBytes: number;
  private readonly maxAgeMs: number;

  constructor(options: DiagnosticsQueueOptions) {
    this.dataDir = options.dataDir;
    this.safeStorage = options.safeStorage;
    this.now = options.now ?? Date.now;
    this.maxReports = options.maxReports ?? DEFAULT_MAX_REPORTS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  }

  enqueue(consented: boolean, input: unknown): boolean {
    if (!consented) {
      this.purge();
      return false;
    }
    this.assertEncryption();
    const payload = serializeDiagnosticEvent(input);
    const event = deserializeDiagnosticEvent(payload);
    const target = this.reportPath(event.eventId);
    if (existsSync(target)) return false;

    const sealed = this.safeStorage.encryptString(payload);
    mkdirSync(this.dataDir, { recursive: true });
    const staged = `${target}.tmp`;
    try {
      writeFileSync(staged, sealed, { flag: 'wx' });
      renameSync(staged, target);
    } finally {
      rmSync(staged, { force: true });
    }
    this.prune();
    return true;
  }

  list(consented: boolean): readonly QueuedDiagnostic[] {
    if (!consented) {
      this.purge();
      return [];
    }
    this.assertEncryption();
    return this.prune();
  }

  remove(eventId: string): void {
    rmSync(this.reportPath(diagnosticEventIdSchema.parse(eventId)), { force: true });
  }

  purge(): void {
    rmSync(this.dataDir, { recursive: true, force: true });
  }

  private prune(): readonly QueuedDiagnostic[] {
    if (!existsSync(this.dataDir)) return [];
    const entries: QueuedDiagnostic[] = [];
    for (const name of readdirSync(this.dataDir)) {
      if (!name.endsWith(REPORT_SUFFIX)) continue;
      const filePath = join(this.dataDir, name);
      try {
        const sealed = readFileSync(filePath);
        const payload = this.safeStorage.decryptString(sealed);
        const event = deserializeDiagnosticEvent(payload);
        if (name !== `${event.eventId}${REPORT_SUFFIX}` || this.isExpired(event)) {
          rmSync(filePath, { force: true });
          continue;
        }
        entries.push({ event, payload, encryptedBytes: statSync(filePath).size });
      } catch {
        rmSync(filePath, { force: true });
      }
    }

    entries.sort((left, right) => left.event.capturedAt.localeCompare(right.event.capturedAt));
    let bytes = entries.reduce((total, entry) => total + entry.encryptedBytes, 0);
    while (entries.length > this.maxReports || bytes > this.maxBytes) {
      const removed = entries.shift();
      if (removed === undefined) break;
      bytes -= removed.encryptedBytes;
      rmSync(this.reportPath(removed.event.eventId), { force: true });
    }
    return entries;
  }

  private isExpired(event: DiagnosticEvent): boolean {
    return this.now() - Date.parse(event.capturedAt) > this.maxAgeMs;
  }

  private assertEncryption(): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new DiagnosticsCustodyError('OS keychain encryption is unavailable; diagnostics remain uncollected.');
    }
  }

  private reportPath(eventId: string): string {
    return join(this.dataDir, `${eventId}${REPORT_SUFFIX}`);
  }
}
