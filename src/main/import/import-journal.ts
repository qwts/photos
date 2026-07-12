import { readFile, rename, rm, writeFile } from 'node:fs/promises';

import type { ImportManifest } from './import-engine.js';

// Staging-manifest persistence (#87): the journal is the crash-safety
// anchor — every per-file stage transition lands on disk (write-then-rename,
// so a torn write can never corrupt the previous good state) and a completed
// batch removes it. On relaunch, a surviving journal means an interrupted
// import to resume.

export class ImportJournal {
  constructor(private readonly path: string) {}

  async read(): Promise<ImportManifest | null> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch {
      return null;
    }
    try {
      return JSON.parse(raw) as ImportManifest;
    } catch {
      return null; // torn/corrupt journal — treat as no pending batch
    }
  }

  async write(manifest: ImportManifest | null): Promise<void> {
    if (manifest === null) {
      await rm(this.path, { force: true });
      return;
    }
    const stage = `${this.path}.tmp`;
    await writeFile(stage, JSON.stringify(manifest), 'utf8');
    await rename(stage, this.path);
  }
}
