import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => {
  class EventRsvpMutationError extends Error {
    constructor(kind: string) {
      super(
        kind === 'forbidden'
          ? 'Nu mai ai permisiunea să răspunzi la acest eveniment.'
          : 'Nu am putut salva răspunsul. Încearcă din nou.',
      );
    }
  }

  return {
    EventRsvpMutationError,
    useEventRsvp: vi.fn(),
    useSetEventRsvp: vi.fn(),
  };
});

vi.mock('../../queries/event-rsvp', () => ({
  EventRsvpMutationError: hooks.EventRsvpMutationError,
  useEventRsvp: hooks.useEventRsvp,
  useSetEventRsvp: hooks.useSetEventRsvp,
}));
vi.mock('@ionic/react', () => ({
  IonButton: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  IonSpinner: () => null,
  IonToast: () => null,
}));

import { EventRsvpMutationError } from '../../queries/event-rsvp';
import EventRsvpControls from './EventRsvpControls';

function rsvpButton(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

describe('EventRsvpControls', () => {
  beforeEach(() => {
    hooks.useEventRsvp.mockReturnValue({
      data: {
        eventId: 7,
        memberId: 'member-1',
        status: 'going',
        checkedIn: false,
      },
      error: null,
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    hooks.useSetEventRsvp.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });
  });

  it('marks the server-confirmed RSVP as selected', () => {
    render(<EventRsvpControls eventId={7} eventTitle="Ședință BC" />);

    expect(rsvpButton('Particip')).toHaveAttribute('aria-pressed', 'true');
    expect(rsvpButton('Nu particip')).toHaveAttribute('aria-pressed', 'false');
  });

  it('disables both answers while one RSVP is being saved', () => {
    hooks.useSetEventRsvp.mockReturnValue({
      isPending: true,
      mutateAsync: vi.fn(),
    });

    render(<EventRsvpControls eventId={7} eventTitle="Ședință BC" />);

    expect(rsvpButton('Particip')).toHaveProperty('disabled', true);
    expect(rsvpButton('Nu particip')).toHaveProperty('disabled', true);
  });

  it('saves the chosen answer and announces success in Romanian', async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({
      eventId: 7,
      memberId: 'member-1',
      status: 'declined',
      checkedIn: false,
    });
    hooks.useSetEventRsvp.mockReturnValue({
      isPending: false,
      mutateAsync,
    });

    render(<EventRsvpControls eventId={7} eventTitle="Ședință BC" />);
    await user.click(rsvpButton('Nu particip'));

    expect(mutateAsync).toHaveBeenCalledWith({
      eventId: 7,
      status: 'declined',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Răspuns salvat: nu participi.',
    );
  });

  it('keeps the confirmed answer selected and announces a safe failure', async () => {
    const user = userEvent.setup();
    hooks.useSetEventRsvp.mockReturnValue({
      isPending: false,
      mutateAsync: vi
        .fn()
        .mockRejectedValue(
          new EventRsvpMutationError('forbidden', { code: '42501' }),
        ),
    });

    render(<EventRsvpControls eventId={7} eventTitle="Ședință BC" />);
    await user.click(rsvpButton('Nu particip'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nu mai ai permisiunea să răspunzi la acest eveniment.',
    );
    expect(rsvpButton('Particip')).toHaveAttribute('aria-pressed', 'true');
    expect(rsvpButton('Nu particip')).toHaveAttribute('aria-pressed', 'false');
  });
});
