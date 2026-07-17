import { OVERLOOK_PRODUCT_NAME } from '../shared/app-identity.js';

interface ProfileApp {
  readonly isPackaged: boolean;
  setName(name: string): void;
  setPath(name: 'userData', path: string): void;
}

export function configureAppProfile(profileApp: ProfileApp, requestedUserData: string | undefined): string | undefined {
  // Keep the existing Overlook profile when the macOS bundle ID changes.
  profileApp.setName(OVERLOOK_PRODUCT_NAME);
  const userDataOverride = profileApp.isPackaged ? undefined : requestedUserData;
  if (userDataOverride !== undefined && userDataOverride !== '') profileApp.setPath('userData', userDataOverride);
  return userDataOverride;
}
