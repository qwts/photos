import path from 'node:path';

import { LibraryRegistry, LibraryRegistryError, ensureDefaultEntry } from './library-registry.js';
import { readOrMintLibraryId } from './library-id.js';
import type { LibraryEntry } from '../../shared/library/registry.js';

// Active-library resolution (ADR-0017 §1/§7, #384), extracted from the
// composition root: the registry replaces the hardcoded userData/library.
// Existing installs resolve to the same directory via the register-in-place
// migration; the live switch arrives with #385.

export interface LibraryRegistryRuntimeOptions {
  readonly userDataDir: () => string;
}

export class LibraryRegistryRuntime {
  private registry: LibraryRegistry | undefined;
  private active: LibraryEntry | undefined;

  constructor(private readonly options: LibraryRegistryRuntimeOptions) {}

  registryPath(): string {
    return path.join(this.options.userDataDir(), 'libraries.json');
  }

  /** The pre-registry hardcoded directory — the migration target (§7). */
  legacyDir(): string {
    return path.join(this.options.userDataDir(), 'library');
  }

  getRegistry(): LibraryRegistry {
    this.registry ??= new LibraryRegistry({ filePath: this.registryPath() });
    return this.registry;
  }

  resolveActive(): LibraryEntry {
    if (this.active === undefined) {
      const registry = this.getRegistry();
      this.active =
        registry.startupEntry() ??
        ensureDefaultEntry(registry, {
          legacyDir: this.legacyDir(),
          libraryId: () => readOrMintLibraryId(this.legacyDir()),
        });
    }
    return this.active;
  }

  dataDir(): string {
    return this.resolveActive().path;
  }

  /** Fail loud, fail closed (§1): a corrupt registry must never be
   * overwritten with an empty one, and with no recovery UI yet (#386) the
   * only honest move is to report and exit — the file is left untouched.
   * Returns the user-facing message, or null when resolution succeeds. */
  resolveFailure(): string | null {
    try {
      this.resolveActive();
      return null;
    } catch (error) {
      if (error instanceof LibraryRegistryError) {
        return `${error.message}\n\nOverlook will not overwrite ${this.registryPath()}. Restore or remove that file, then relaunch.`;
      }
      throw error;
    }
  }

  /** Open-time identity check (§2): the directory's library-id file is
   * authoritative — mint it eagerly if absent and heal the registry's cached
   * id if they diverge. Returns the healed entry. */
  healActiveId(): LibraryEntry {
    const entry = this.resolveActive();
    const directoryId = readOrMintLibraryId(entry.path);
    if (directoryId !== entry.id) {
      this.active = this.getRegistry().updateId(entry.id, directoryId);
    }
    return this.active ?? entry;
  }

  /** Stamped at successful DB open — not at close, so a crash never loses
   * the startup selection (§1). */
  markOpened(): LibraryEntry {
    this.active = this.getRegistry().touchOpened(this.resolveActive().id);
    return this.active;
  }
}
