import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { usePushSubscription } from '../../queries/push-subscription';

type PushState = ReturnType<typeof usePushSubscription>;

const hook = vi.hoisted(() => ({
  state: null as unknown as PushState,
  enable: vi.fn(),
  disable: vi.fn(),
}));

vi.mock('../../queries/push-subscription', () => ({
  usePushSubscription: () => hook.state,
}));

// The per-kind switches have their own suite (PushPreferences.test.tsx).
vi.mock('./PushPreferences', () => ({
  PushPreferences: () => null,
}));

import { PushDeviceCard } from './PushDeviceCard';

function answer(overrides: Partial<PushState> = {}) {
  hook.state = {
    supported: true,
    configured: true,
    permission: 'default',
    subscribed: false,
    target: null,
    revoked: false,
    loading: false,
    pending: false,
    error: null,
    enable: hook.enable,
    disable: hook.disable,
    ...overrides,
  };
}

function theSwitch() {
  return screen.getByRole('switch', { name: 'Notificări push' });
}

describe('PushDeviceCard', () => {
  beforeEach(() => {
    hook.enable.mockClear();
    hook.disable.mockClear();
    answer();
  });

  it('is off with its copy, and turning it on enables push', async () => {
    const user = userEvent.setup();
    const { container } = render(<PushDeviceCard />);

    expect(theSwitch()).not.toBeChecked();
    expect(theSwitch()).toHaveAccessibleDescription(
      'Nu primești notificări pe acest dispozitiv',
    );
    await user.click(theSwitch());
    expect(hook.enable).toHaveBeenCalledTimes(1);
    expect(hook.disable).not.toHaveBeenCalled();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('is on with its copy, and turning it off disables push', async () => {
    answer({ permission: 'granted', subscribed: true });
    const user = userEvent.setup();
    const { container } = render(<PushDeviceCard />);

    expect(theSwitch()).toBeChecked();
    expect(theSwitch()).toHaveAccessibleDescription(
      'Primești notificări pe acest dispozitiv',
    );
    await user.click(theSwitch());
    expect(hook.disable).toHaveBeenCalledTimes(1);
    expect(hook.enable).not.toHaveBeenCalled();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('asks for the home-screen install where push is unsupported', async () => {
    answer({ supported: false, permission: 'unsupported' });
    const user = userEvent.setup();
    const { container } = render(<PushDeviceCard />);

    expect(theSwitch()).toHaveAttribute('aria-disabled', 'true');
    expect(theSwitch()).not.toBeChecked();
    expect(
      screen.getByText(
        'Instalează aplicația pe ecranul principal pentru a primi notificări',
      ),
    ).toBeVisible();
    await user.click(theSwitch());
    expect(hook.enable).not.toHaveBeenCalled();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('points to the browser settings when permission is denied', async () => {
    // Even a leftover subscription reads as off: nothing can be shown.
    answer({ permission: 'denied', subscribed: true });
    const user = userEvent.setup();
    const { container } = render(<PushDeviceCard />);

    expect(theSwitch()).toHaveAttribute('aria-disabled', 'true');
    expect(theSwitch()).not.toBeChecked();
    expect(
      screen.getByText('Notificările sunt blocate din setările browserului'),
    ).toBeVisible();
    await user.click(theSwitch());
    expect(hook.enable).not.toHaveBeenCalled();
    expect(hook.disable).not.toHaveBeenCalled();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('stays disabled when the build has no VAPID key', () => {
    answer({ configured: false });
    render(<PushDeviceCard />);

    expect(theSwitch()).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByText('Notificările pe dispozitiv nu sunt disponibile încă'),
    ).toBeVisible();
  });

  it('holds the switch while a change is in flight', () => {
    answer({ pending: true });
    render(<PushDeviceCard />);
    expect(theSwitch()).toHaveAttribute('aria-disabled', 'true');
  });

  it('moves at the tap: shows the state a change is heading to while it runs (2026-10-06)', () => {
    // Subscribing can take seconds; a switch that sat still drew a second tap
    // that turned push straight back off (production, six times in four days).
    answer({ pending: true, target: true });
    const { rerender } = render(<PushDeviceCard />);
    expect(theSwitch()).toBeChecked();
    expect(theSwitch()).toHaveAttribute('aria-disabled', 'true');
    expect(theSwitch()).toHaveAccessibleDescription(
      'Se pornesc notificările pe acest dispozitiv…',
    );

    answer({ pending: true, target: false, subscribed: true });
    rerender(<PushDeviceCard />);
    expect(theSwitch()).not.toBeChecked();
    expect(theSwitch()).toHaveAccessibleDescription(
      'Se opresc notificările pe acest dispozitiv…',
    );
  });

  it('says so when the browser took back the permission of a device that had push on', async () => {
    answer({ permission: 'default', revoked: true });
    const user = userEvent.setup();
    const { container } = render(<PushDeviceCard />);

    expect(theSwitch()).not.toBeChecked();
    expect(theSwitch()).toHaveAccessibleDescription(
      'Browserul a oprit notificările pe acest dispozitiv. Pornește-le din nou.',
    );
    await user.click(theSwitch());
    expect(hook.enable).toHaveBeenCalledTimes(1);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('announces a failure in Romanian', () => {
    answer({ error: 'Nu am putut schimba notificările pe acest dispozitiv.' });
    render(<PushDeviceCard />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nu am putut schimba notificările pe acest dispozitiv.',
    );
  });
});
