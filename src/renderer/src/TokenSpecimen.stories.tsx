import type { Meta, StoryObj } from '@storybook/react-vite';

import { TokenSpecimen } from './TokenSpecimen';

// The same specimen surface the shell renders (#54) — neutrals, accents +
// dims, type scale — on the real token canvas.
const meta: Meta<typeof TokenSpecimen> = {
  title: 'Foundations/Tokens',
  component: TokenSpecimen,
};

export default meta;
type Story = StoryObj<typeof TokenSpecimen>;

export const Specimen: Story = {};
