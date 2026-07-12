import eslintReact from '@eslint-react/eslint-plugin';
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'out/**',
      '.test-dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'node_modules/**',
      // Agent worktrees carry in-progress copies of the repo; linting them from the
      // main checkout breaks local gates on unrelated work (prettier already ignores
      // .claude/ via .prettierignore).
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Size discipline, repo-wide from day one (greenfield: no legacy exemptions).
      // Keep the 800 budget in sync with scripts/check-new-file-size.mjs — that script
      // guards new/untracked files with a physical-line count; this rule is what stops
      // EXISTING files growing past the cap (it skips blanks/comments, so it is the
      // slightly looser bound of the pair).
      'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // React correctness for the renderer (#51): hooks rules are
    // non-negotiable; @eslint-react (the eslint-10-compatible successor to
    // eslint-plugin-react) covers JSX/runtime pitfalls type-aware.
    files: ['src/renderer/**/*.tsx', 'src/renderer/**/*.ts'],
    extends: [reactHooks.configs.flat.recommended, eslintReact.configs['recommended-type-checked']],
  },
  // Process-boundary layering (#49), the full matrix from CLAUDE.md
  // §Architecture: every process dir may import src/shared; shared is
  // process-free; nothing else crosses — the typed IPC bridge is the only
  // channel. One override per layer so each direction is actually enforced.
  ...[
    { files: 'src/renderer/**', banned: ['**/main/**', '**/main', '**/preload/**', '**/preload'] },
    { files: 'src/preload/**', banned: ['**/main/**', '**/main', '**/renderer/**'] },
    { files: 'src/shared/**', banned: ['**/main/**', '**/main', '**/preload/**', '**/preload', '**/renderer/**'] },
    { files: 'src/main/**', banned: ['**/renderer/**', '**/preload/**', '**/preload'] },
  ].map(({ files, banned }) => ({
    files: [files],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: banned,
              message: `${files} may import src/shared only; cross-process traffic rides the typed IPC bridge.`,
            },
          ],
        },
      ],
    },
  })),
  {
    // node:test's test()/describe() return promises that the runner itself awaits;
    // requiring `void`/`await` on every registration is pure noise. Scope the
    // exemption to exactly those calls so a missed await on an async helper or
    // assertion inside a test still fails lint.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [{ from: 'package', name: ['test', 'describe', 'it', 'suite'], package: 'node:test' }],
        },
      ],
    },
  },
  {
    // Plain-JS Node scripts (and this config file) are outside the TS project;
    // type-aware rules can't apply. no-undef is off for Node globals (console),
    // matching image-trail — TS owns undefined-identifier checking for source.
    files: ['**/*.mjs', 'eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      'no-undef': 'off',
    },
  },
);
