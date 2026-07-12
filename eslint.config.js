import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
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
