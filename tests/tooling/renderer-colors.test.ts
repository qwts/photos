import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

interface RendererColorViolation {
  readonly file: string;
  readonly line: number;
  readonly literal: string;
}

interface RendererColorsModule {
  findRendererColorLiterals(files: readonly { file: string; source: string }[]): RendererColorViolation[];
}

test('renderer color-token gate ignores token sources and reports component literals with lines (#395)', async () => {
  const checker = (await import(pathToFileURL(join(process.cwd(), 'scripts/check-renderer-colors.mjs')).href)) as RendererColorsModule;
  assert.deepEqual(
    checker.findRendererColorLiterals([
      { file: 'src/components/example.css', source: '/* #fff */\n.good { color: var(--text-body); }\n.bad { background: rgb(0 0 0); }' },
      { file: 'src/styles/tokens/colors.css', source: ':root { --black: #000; }' },
      { file: 'src/example.ts', source: 'const color = "#fff";' },
    ]),
    [{ file: 'src/components/example.css', line: 3, literal: 'rgb(' }],
  );
});
