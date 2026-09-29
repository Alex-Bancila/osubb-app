import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: vi.fn(),
  capabilities: vi.fn(),
  options: vi.fn(),
  attendance: vi.fn(),
  identities: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/auth', () => ({ useAuth: state.auth }));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: state.capabilities,
}));
vi.mock('../../queries/event-creation', () => ({
  useEventFormOptions: state.options,
}));
vi.mock('../../queries/event-attendance', async (importActual) => ({
  ...(await importActual<typeof import('../../queries/event-attendance')>()),
  useEventAttendance: state.attendance,
}));
vi.mock('../../queries/member-identities', () => ({
  useMemberIdentities: state.identities,
}));
vi.mock('../../components/member/MemberName', () => ({
  MemberName: ({
    nickname,
    fullName,
  }: {
    nickname?: string | null;
    fullName: string;
  }) => <button type="button">{nickname || fullName}</button>,
}));

import type { EventPresentation } from '../../queries/events';
import { EventAttendance } from './EventAttendance';

const MEMBER = 'd0000000-0000-0000-0000-000000000006';

const managerOptions = {
  groups: [
    {
      id: 7,
      name: 'Educațional',
      path: [7],
      minLevel: 0,
      isOrganization: false,
    },
  ],
  groupNames: [{ id: 7, name: 'Educațional' }],
  campaigns: [],
};

function event(overrides: Partial<EventPresentation> = {}): EventPresentation {
  return {
    id: 31,
    title: 'Ședință Educațional',
    type: 'sedinta',
    groupId: 7,
    group: {
      name: 'Educațional',
      short: 'EDU',
      color: '#284C93',
      category: 'department',
      path: [7],
      is_organization: false,
    },
    campaignId: null,
    startsAt: '2030-10-01T15:00:00.000Z',
    endsAt: null,
    dayKey: '2030-10-01',
    dayLabel: 'marți, 1 octombrie 2030',
    startTime: '18:00',
    endTime: null,
    location: null,
    capacity: null,
    description: null,
    minLevel: 0,
    createdBy: 'someone-else',
    cancelledAt: null,
    cancelReason: null,
    ...overrides,
  };
}

const identities = new Map([
  ['m1', { memberId: 'm1', fullName: 'Zamfir Ioana', nickname: null }],
  ['m2', { memberId: 'm2', fullName: 'Andrei Pop', nickname: 'Andi' }],
  ['m3', { memberId: 'm3', fullName: 'Bianca Rus', nickname: null }],
]);

function answered(going: string[], declined: string[]) {
  state.attendance.mockReturnValue({
    data: { going, declined },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
}

describe('EventAttendance — Cine participă (#934)', () => {
  beforeEach(() => {
    state.auth.mockReturnValue({ session: { user: { id: MEMBER } } });
    state.capabilities.mockReturnValue({
      data: { createTopLevelGroups: false, managesAnyGroup: true },
    });
    state.options.mockReturnValue({ data: managerOptions });
    state.identities.mockReturnValue({ data: identities, isPending: false });
    answered(['m1', 'm2'], ['m3']);
  });

  it('shows a manager the counts, then who answered, grouped with a count each', async () => {
    const user = userEvent.setup();
    render(<EventAttendance event={event()} />);

    expect(screen.getByText('2 participă · 1 nu')).toBeVisible();
    const toggle = screen.getByRole('button', { name: 'Cine participă' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('heading', { name: /Particip/ })).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const going = screen.getByRole('region', { name: 'Particip 2' });
    // Sorted by the name shown: the Nickname when there is one.
    expect(
      within(going)
        .getAllByRole('button')
        .map((name) => name.textContent),
    ).toEqual(['Andi', 'Zamfir Ioana']);
    const declined = screen.getByRole('region', { name: 'Nu particip 1' });
    expect(within(declined).getByRole('button')).toHaveTextContent(
      'Bianca Rus',
    );
  });

  it('asks for the answers only once the viewer is known to manage the Event', () => {
    render(<EventAttendance event={event()} />);
    expect(state.attendance).toHaveBeenCalledWith(31, true);
  });

  it('shows nothing, and reads nothing, for a Member who does not manage the Event', () => {
    state.capabilities.mockReturnValue({
      data: { createTopLevelGroups: false, managesAnyGroup: false },
    });
    state.options.mockReturnValue({
      data: { groups: [], groupNames: [], campaigns: [] },
    });
    const { container } = render(<EventAttendance event={event()} />);
    expect(container).toBeEmptyDOMElement();
    expect(state.attendance).toHaveBeenLastCalledWith(31, false);
  });

  it("shows nothing on another Group's Event", () => {
    const { container } = render(
      <EventAttendance event={event({ groupId: 20 })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('still shows a cancelled Event’s answers to its managers', () => {
    render(
      <EventAttendance
        event={event({ cancelledAt: '2030-09-30T10:00:00Z' })}
      />,
    );
    expect(screen.getByText('2 participă · 1 nu')).toBeVisible();
  });

  it('says so when nobody has answered, with nothing to open', () => {
    answered([], []);
    render(<EventAttendance event={event()} />);
    expect(screen.getByText('Niciun răspuns încă')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cine participă' })).toBeNull();
  });

  it('writes Nimeni under an empty group', async () => {
    answered(['m1'], []);
    const user = userEvent.setup();
    render(<EventAttendance event={event()} />);
    expect(screen.getByText('1 participă · 0 nu')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cine participă' }));
    const declined = screen.getByRole('region', { name: 'Nu particip 0' });
    expect(within(declined).getByText('Nimeni.')).toBeVisible();
  });

  it('offers a retry when the answers do not load', async () => {
    const refetch = vi.fn();
    state.attendance.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch,
    });
    const user = userEvent.setup();
    render(<EventAttendance event={event()} />);
    expect(screen.getByText('Răspunsurile nu s-au încărcat.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Reîncearcă' }));
    expect(refetch).toHaveBeenCalled();
  });
});
