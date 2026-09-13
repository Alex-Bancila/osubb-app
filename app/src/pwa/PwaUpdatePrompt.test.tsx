import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';

const registration = vi.hoisted(() => ({
  needRefresh: true,
  setNeedRefresh: vi.fn(),
  updateServiceWorker: vi.fn<() => Promise<void>>(),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [registration.needRefresh, registration.setNeedRefresh],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: registration.updateServiceWorker,
  }),
}));

describe('PwaUpdatePrompt', () => {
  beforeEach(() => {
    registration.needRefresh = true;
    registration.updateServiceWorker.mockResolvedValue();
  });

  it('asks before activating a waiting service worker', async () => {
    const user = userEvent.setup();
    render(<PwaUpdatePrompt />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'O versiune nouă a aplicației este disponibilă.',
    );
    await user.click(
      screen.getByRole('button', { name: 'Actualizează aplicația' }),
    );
    expect(registration.updateServiceWorker).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole('button', { name: 'Mai târziu' }));
    expect(registration.setNeedRefresh).toHaveBeenCalledWith(false);
  });

  it('stays out of the page when no update is waiting', () => {
    registration.needRefresh = false;
    render(<PwaUpdatePrompt />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the prompt open and explains a failed update', async () => {
    const user = userEvent.setup();
    registration.updateServiceWorker.mockRejectedValueOnce(
      new Error('offline'),
    );
    render(<PwaUpdatePrompt />);

    await user.click(
      screen.getByRole('button', { name: 'Actualizează aplicația' }),
    );

    expect(
      await screen.findByText(/Nu am putut actualiza aplicația/),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toBeVisible();
  });
});
