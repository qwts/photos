import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import type { OverlookApi } from '../../../shared/ipc/api.js';
import { LockScreen } from './LockScreen';

function installStub(result: Awaited<ReturnType<OverlookApi['appLock']['unlock']>>): void {
  (globalThis as { overlook?: Partial<OverlookApi> }).overlook = {
    appLock: {
      status: () => Promise.resolve({ state: 'locked', libraryId: 'story-library', retryAfterMs: 0 }),
      unlock: () => Promise.resolve(result),
      configure: () => Promise.reject(new Error('not used')),
      lockNow: () => Promise.reject(new Error('not used')),
      changePassword: () => Promise.reject(new Error('not used')),
      remove: () => Promise.reject(new Error('not used')),
      pickRecovery: () => Promise.resolve({ path: '/Users/ansel/Desktop/overlook-recovery.key' }),
      recover: () => Promise.resolve({ recovered: true, reason: null }),
      touchIdStatus: () => Promise.resolve({ available: true, reason: null, enabled: true, reenrollmentRequired: false }),
      touchIdEnable: () => Promise.resolve({ enabled: true, reason: null }),
      touchIdDisable: () => Promise.resolve({ disabled: true }),
      touchIdUnlock: () => Promise.resolve({ ok: false, reason: 'cancelled' }),
      onChanged: () => () => undefined,
      onTouchIdChanged: () => () => undefined,
    },
    minimizeWindow: () => Promise.resolve(),
    toggleMaximizeWindow: () => Promise.resolve(false),
    closeWindow: () => Promise.resolve(),
  };
}

const meta: Meta<typeof LockScreen> = {
  title: 'App/LockScreen',
  component: LockScreen,
  args: { platform: 'darwin', state: 'locked', retryAfterMs: 0 },
  decorators: [
    (Story) => {
      installStub({ ok: false, reason: 'wrong-password', retryAfterMs: 1_000 });
      return <Story />;
    },
  ],
};

export default meta;
type Story = StoryObj<typeof LockScreen>;

export const PasswordFailureAndThrottle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Library locked')).toBeVisible();
    const password = canvas.getByLabelText('App password');
    await expect(password).toHaveAttribute('autocomplete', 'current-password');
    await expect(password).toHaveAttribute('name', 'app-password');
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    password.dispatchEvent(copy);
    await expect(copy.defaultPrevented).toBe(true);
    await userEvent.type(password, 'wrong password');
    await userEvent.click(canvas.getByRole('button', { name: 'Unlock' }));
    await expect(await canvas.findByText('That password did not unlock this library.')).toBeVisible();
    await expect(canvas.getByRole('button', { name: /Try again in/u })).toBeDisabled();
  },
};

export const TouchIdCancellationKeepsPasswordFallback: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Unlock with Touch ID' }));
    await expect(await canvas.findByText('Touch ID was cancelled. Try again or enter your app password.')).toBeVisible();
    await expect(canvas.getByLabelText('App password')).toBeEnabled();
    await expect(canvas.getByRole('button', { name: 'Unlock' })).toBeVisible();
  },
};

export const RecoveryRequired: Story = {
  args: { state: 'recovery-required' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Recovery required')).toBeVisible();
    await expect(canvas.queryByLabelText('App password')).not.toBeInTheDocument();
    await expect(canvas.getByText(/exported recovery key/u)).toBeVisible();
  },
};
