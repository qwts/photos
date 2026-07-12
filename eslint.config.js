import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.test-dist/**',
      'coverage/**',
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
    // requiring `void`/`await` on every top-level registration is pure noise.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
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
