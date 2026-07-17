import { dialog } from 'electron';

/** Native directory picker for the library flows (#386): create-location and
 * add-existing. The harness fixture bypasses the native dialog — '' means the
 * user cancelled, anything else is the chosen directory. */
export async function pickLibraryDirectory(fixture?: string): Promise<string | null> {
  if (fixture !== undefined) return fixture === '' ? null : fixture;
  const result = await dialog.showOpenDialog({
    title: 'Choose library folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}
