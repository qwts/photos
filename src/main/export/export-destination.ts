import { dialog } from 'electron';

/** Export destination picker (#72 harness-steerable): the E2E fixture wins;
 * otherwise the native directory dialog. */
export async function pickExportDestination(harnessEnv: (name: string) => string | undefined): Promise<string | null> {
  const fixture = harnessEnv('OVERLOOK_EXPORT_DESTINATION');
  if (fixture !== undefined && fixture !== '') return fixture;
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}
