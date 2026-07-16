declare const __OVERLOOK_GOOGLE_DRIVE_CLIENT_ID__: string;

/** OAuth desktop client IDs are public identifiers, not secrets. The build
 * embeds the owner-supplied ID; an empty build keeps Drive visible but
 * unavailable instead of reading a steerable runtime environment value. */
export function bundledGoogleDriveClientId(): string | null {
  const value = typeof __OVERLOOK_GOOGLE_DRIVE_CLIENT_ID__ === 'string' ? __OVERLOOK_GOOGLE_DRIVE_CLIENT_ID__.trim() : '';
  return value.endsWith('.apps.googleusercontent.com') ? value : null;
}
