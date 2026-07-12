import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactElement } from 'react';
import { expect } from 'storybook/test';

import { Icon, ICON_NAMES } from './Icon';

const meta: Meta<typeof Icon> = {
  title: 'Core/Icon',
  component: Icon,
};

export default meta;
type Story = StoryObj<typeof Icon>;

function Vocabulary(): ReactElement {
  return (
    <div style={{ padding: 'var(--space-7)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
          gap: 'var(--space-5)',
        }}
      >
        {ICON_NAMES.map((name) => (
          <div
            key={name}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            <Icon name={name} size={20} />
            <span className="mono-data" style={{ color: 'var(--text-faint)' }}>
              {name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// The full fixed vocabulary at toolbar size; the play assertion is the CI
// interaction-test gate's first content (#56) — every glyph must actually
// render an SVG at stroke 1.75.
export const FullVocabulary: Story = {
  render: () => <Vocabulary />,
  play: async ({ canvasElement }) => {
    const svgs = canvasElement.querySelectorAll('svg');
    await expect(svgs).toHaveLength(ICON_NAMES.length);
    for (const svg of svgs) {
      await expect(svg.getAttribute('stroke-width')).toBe('1.75');
    }
  },
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 'var(--space-5)', padding: 'var(--space-7)', alignItems: 'center' }}>
      <Icon name="aperture" size={14} />
      <Icon name="aperture" size={16} />
      <Icon name="aperture" size={20} />
      <Icon name="cloud-check" size={20} color="var(--accent-green)" />
      <Icon name="cloud-upload" size={20} color="var(--accent-amber)" />
      <Icon name="trash-2" size={20} color="var(--accent-red)" />
    </div>
  ),
};
