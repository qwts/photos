import { useEffect, type ReactElement } from 'react';
import type { Decorator, Preview } from '@storybook/react-vite';

export type StoryTheme = 'dark' | 'light';

export const themeGlobalType: NonNullable<Preview['globalTypes']> = {
  theme: {
    description: 'First-party appearance',
    defaultValue: 'dark',
    toolbar: {
      icon: 'paintbrush',
      dynamicTitle: true,
      items: [
        { value: 'dark', title: 'Dark' },
        { value: 'light', title: 'Light' },
      ],
    },
  },
};

function ThemeStory({ theme, children }: { readonly theme: StoryTheme; readonly children: ReactElement }): ReactElement {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset['theme'] = theme;
    root.style.colorScheme = theme;
    return () => {
      delete root.dataset['theme'];
      root.style.colorScheme = '';
    };
  }, [theme]);
  return children;
}

export const withTheme: Decorator = (Story, context) => {
  const theme = context.globals['theme'] === 'light' ? 'light' : 'dark';
  return (
    <ThemeStory theme={theme}>
      <Story />
    </ThemeStory>
  );
};
