declare const __OVERLOOK_GOOGLE_DRIVE_CLIENT_ID__: string;
declare const __OVERLOOK_GOOGLE_DRIVE_CLIENT_SECRET__: string;

/** OAuth desktop client IDs are public identifiers, not secrets. The build
 * embeds the owner-supplied ID; an empty build keeps Drive visible but
 * unavailable instead of reading a steerable runtime environment value. */
export function bundledGoogleDriveClientId(): string | null {
  const value = typeof __OVERLOOK_GOOGLE_DRIVE_CLIENT_ID__ === 'string' ? __OVERLOOK_GOOGLE_DRIVE_CLIENT_ID__.trim() : '';
  return value.endsWith('.apps.googleusercontent.com') ? value : null;
}

/** Some issued Google Desktop clients require their generated credential at
 * the token endpoint. Installed-app credentials are extractable metadata, not
 * a confidentiality boundary; keep this value main-process-only regardless. */
export function bundledGoogleDriveClientSecret(): string | null {
  const value = typeof __OVERLOOK_GOOGLE_DRIVE_CLIENT_SECRET__ === 'string' ? __OVERLOOK_GOOGLE_DRIVE_CLIENT_SECRET__.trim() : '';
  return value === '' ? null : value;
}
