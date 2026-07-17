import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/renderer/src/**/*.stories.tsx'],
  // The a11y panel is AUTHORING feedback, not a gate — the gate is test-runner.ts, which
  // runs axe over every story against the budget and fails CI. This puts the same engine
  // in front of whoever is writing the story, so a violation is seen before it is
  // committed rather than in a CI log afterwards. Deliberately not `test: 'error'`: that
  // would double-run axe per story with the addon's own default rule set, which is NOT
  // the WCAG 2.2 AA tag set the budget is counted against (the exact mistake PR #408
  // shipped and had to fix), and the two would disagree.
  addons: ['@storybook/addon-a11y'],
};

export default config;
