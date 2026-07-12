import type { Preview } from '@storybook/react-vite';

// The token styles entry is the same one the renderer loads (#54): stories
// render on the real dark canvas with the real tokens — no Storybook theme
// duplication to drift.
import '../src/renderer/src/styles/index.css';

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
  },
};

export default preview;
