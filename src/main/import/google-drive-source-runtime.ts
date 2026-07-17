import path from 'node:path';

import { shell } from 'electron';

import { bundledGoogleDriveClientId, bundledGoogleDriveClientSecret } from '../build-config.js';
import { GoogleDriveImportSource } from './google-drive-source.js';

/** Electron composition kept out of the domain source and the already-large
 * application root. Harness steering remains unpackaged-only at the caller. */
export function createDriveImport(dataDir: string, fixtureSource: () => string | undefined): GoogleDriveImportSource {
  return new GoogleDriveImportSource({
    stagingRoot: path.join(dataDir, 'google-drive-import'),
    clientId: bundledGoogleDriveClientId,
    clientSecret: bundledGoogleDriveClientSecret,
    openExternal: (url) => shell.openExternal(url),
    fixtureSource,
  });
}
