import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { OVERLOOK_PRODUCT_NAME } from '../shared/app-identity.js';

interface ProfileApp {
  readonly isPackaged: boolean;
  getPath(name: 'appData' | 'userData'): string;
  setName(name: string): void;
  setPath(name: 'userData', path: string): void;
}

function hasProfileCustody(profilePath: string): boolean {
  return [
    path.join(profilePath, 'libraries.json'),
    path.join(profilePath, 'library', 'library.db'),
    path.join(profilePath, 'provider-auth', 'pcloud', 'pcloud-auth.bin'),
    path.join(profilePath, 'provider-auth', 'google-drive', 'google-drive-auth.bin'),
  ].some((candidate) => existsSync(candidate));
}

export function configureAppProfile(profileApp: ProfileApp, requestedUserData: string | undefined): string | undefined {
  // app.setName() does not promise to repoint an already-resolved userData
  // path. Capture Electron's packaged default first, then explicitly bind the
  // process to the established Overlook profile (#479). This keeps the
  // registry and provider custody visible across reinstall and app-id changes.
  const initialUserData = profileApp.getPath('userData');
  const stableUserData = path.join(profileApp.getPath('appData'), OVERLOOK_PRODUCT_NAME);
  profileApp.setName(OVERLOOK_PRODUCT_NAME);
  const userDataOverride = profileApp.isPackaged ? undefined : requestedUserData;
  if (userDataOverride !== undefined && userDataOverride !== '') {
    profileApp.setPath('userData', userDataOverride);
    return userDataOverride;
  }
  // Development must use the same stable Overlook identity as the packaged
  // app unless a harness explicitly requests an isolated profile. Packaged
  // reinstalls may preserve a populated Electron-selected profile, but no
  // implicit alternate product identity is discovered.
  const selected =
    profileApp.isPackaged && !hasProfileCustody(stableUserData) && hasProfileCustody(initialUserData) ? initialUserData : stableUserData;
  mkdirSync(selected, { recursive: true });
  profileApp.setPath('userData', selected);
  return userDataOverride;
}
