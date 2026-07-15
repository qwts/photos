import { dialog } from 'electron';

export async function pickRecoveryKeyPath(fixture?: string): Promise<string | null> {
  if (fixture !== undefined && fixture !== '') return fixture;
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Overlook recovery key', extensions: ['key'] }],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}
