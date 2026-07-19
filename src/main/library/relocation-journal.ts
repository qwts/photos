import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { relocationJournalSchema, type RelocationJournal, type RelocationState } from '../../shared/library/relocation.js';

// Relocation journal persistence (ADR-0022 §2, #483). One journal per
// library at <journalDir>/<libraryId>.json, atomic tmp+rename, fail-loud:
// recovery acts only on what a journal records, and a corrupt journal must
// stop recovery for that library rather than let it guess at disk state.
// The journal lives in the profile root — not inside staging — because
// recovery must still run when the destination volume is unplugged.

export class RelocationJournalError extends Error {
  override readonly name = 'RelocationJournalError';
}

export class RelocationJournalStore {
  constructor(private readonly journalDir: string) {}

  private filePath(libraryId: string): string {
    return path.join(this.journalDir, `${libraryId}.json`);
  }

  /** Absent is a valid state (no move in flight) — distinct from corrupt. */
  load(libraryId: string): RelocationJournal | null {
    const file = this.filePath(libraryId);
    if (!existsSync(file)) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new RelocationJournalError(
        `relocation journal for ${libraryId} is unreadable or not JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const parsed = relocationJournalSchema.safeParse(raw);
    if (!parsed.success) {
      throw new RelocationJournalError(
        `relocation journal for ${libraryId} failed validation: ${parsed.error.issues[0]?.message ?? 'unknown issue'}`,
      );
    }
    return parsed.data;
  }

  save(journal: RelocationJournal): RelocationJournal {
    const parsed = relocationJournalSchema.parse(journal);
    mkdirSync(this.journalDir, { recursive: true });
    const file = this.filePath(parsed.libraryId);
    const staging = `${file}.tmp`;
    writeFileSync(staging, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    renameSync(staging, file);
    return parsed;
  }

  advance(journal: RelocationJournal, state: RelocationState): RelocationJournal {
    return this.save({ ...journal, state });
  }

  clear(libraryId: string): void {
    rmSync(this.filePath(libraryId), { force: true });
  }

  /** Every journal on disk — startup recovery's work list. A corrupt journal
   * surfaces as an error entry so the caller can report it without blocking
   * recovery of the healthy ones. */
  list(): readonly { readonly libraryId: string; readonly journal: RelocationJournal | Error }[] {
    if (!existsSync(this.journalDir)) return [];
    const items: { readonly libraryId: string; readonly journal: RelocationJournal | Error }[] = [];
    for (const name of readdirSync(this.journalDir)) {
      if (!name.endsWith('.json')) continue;
      const libraryId = name.slice(0, -'.json'.length);
      try {
        const journal = this.load(libraryId);
        if (journal !== null) items.push({ libraryId, journal });
      } catch (error) {
        items.push({ libraryId, journal: error instanceof Error ? error : new Error(String(error)) });
      }
    }
    return items;
  }
}
