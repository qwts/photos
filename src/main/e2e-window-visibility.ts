export interface InitialWindowVisibilityInput {
  readonly packaged: boolean;
  readonly harness: string | undefined;
  readonly mode: string | undefined;
}

/** Keep native windows out of the user's way during Electron E2E runs.
 * Packaged apps and ordinary development launches always remain visible. */
export function shouldShowInitialWindow({ packaged, harness, mode }: InitialWindowVisibilityInput): boolean {
  return packaged || harness !== '1' || mode !== 'hidden';
}
