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
    allDay: false,
    lastDayKey: overrides.dayKey ?? '2030-10-01',
    multiDay: false,
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
    approvalStatus: 'approved',
    rejectionReason: null,
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
      data: {
        createTopLevelGroups: false,
        managesAnyGroup: true,
        seeLeadership: false,
      },
    });
    state.options.mockReturnValue({ data: managerOptions });
    state.identities.mockReturnValue({ data: identities, isPending: false });
    answered(['m1', 'm2'], ['m3']);
  });

  const toggle = () => screen.getByRole('button', { name: 'Cine participă' });

  /** Opens Cine participă, as a manager's tap does. */
  async function opened(shown = event()) {
    const user = userEvent.setup();
    render(<EventAttendance event={shown} />);
    await user.click(toggle());
    return user;
  }

  it('shows a manager the counts, then who answered, grouped with a count each, once opened', async () => {
    await opened();

    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('2 participă · 1 nu')).toBeVisible();
    // One row: the bar of the split sits between the label and the counts.
    const row = toggle().parentElement;
    expect(row).toContainElement(screen.getByText('2 participă · 1 nu'));
    const bar = row?.querySelector<HTMLElement>('.event-attendance-bar');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(bar?.style.getPropertyValue('--going-share')).toMatch(/^66\.6/);

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

  // #1134: a list of sixty cards must not read sixty Events' answers, nor
  // their names, on open and again on every change.
  it('reads nothing until it is opened, and shows nothing it has not read', async () => {
    const user = userEvent.setup();
    render(<EventAttendance event={event()} />);

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(toggle()).not.toHaveAttribute('aria-controls');
    expect(state.attendance).toHaveBeenCalledWith(31, false);
    expect(state.attendance).not.toHaveBeenCalledWith(31, true);
    expect(screen.queryByText('2 participă · 1 nu')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(state.identities).not.toHaveBeenCalled();

    await user.click(toggle());
    expect(state.attendance).toHaveBeenLastCalledWith(31, true);
    expect(state.identities).toHaveBeenCalledWith(['m1', 'm2', 'm3']);

    // Closed again: the read stays in the cache, nothing is drawn of it.
    await user.click(toggle());
    expect(state.attendance).toHaveBeenLastCalledWith(31, false);
    expect(screen.queryByText('2 participă · 1 nu')).toBeNull();
  });

  it('says the answers are on their way while they are read', async () => {
    state.attendance.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: vi.fn(),
    });
    await opened();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Se încarcă răspunsurile…',
    );
  });

  it('shows nothing, and reads nothing, for a Member who does not manage the Event', () => {
    state.capabilities.mockReturnValue({
      data: {
        createTopLevelGroups: false,
        managesAnyGroup: false,
        seeLeadership: false,
      },
    });
    state.options.mockReturnValue({
      data: { groups: [], groupNames: [], campaigns: [] },
    });
    const { container } = render(<EventAttendance event={event()} />);
    expect(container).toBeEmptyDOMElement();
    expect(state.attendance).toHaveBeenLastCalledWith(31, false);
  });

  describe('every BCE and above reads it (R61)', () => {
    beforeEach(() => {
      // A BCE who manages no Group: no Group to create an Event in.
      state.capabilities.mockReturnValue({
        data: {
          createTopLevelGroups: false,
          managesAnyGroup: false,
          seeLeadership: true,
        },
      });
      state.options.mockReturnValue({
        data: { groups: [], groupNames: [], campaigns: [] },
      });
    });

    it('shows a BCE who manages nothing the answers on any Event', async () => {
      await opened(event({ groupId: 20 }));
      expect(state.attendance).toHaveBeenLastCalledWith(31, true);
      expect(screen.getByText('2 participă · 1 nu')).toBeVisible();
      expect(screen.getByRole('region', { name: 'Particip 2' })).toBeVisible();
    });

    it('does not wait for the Event form options to know a BCE', async () => {
      state.options.mockReturnValue({ data: undefined });
      await opened();
      expect(state.attendance).toHaveBeenLastCalledWith(31, true);
      expect(screen.getByText('2 participă · 1 nu')).toBeVisible();
    });

    it('still shows nothing to a Member below BCE who manages nothing', () => {
      state.capabilities.mockReturnValue({
        data: {
          createTopLevelGroups: false,
          managesAnyGroup: false,
          seeLeadership: false,
        },
      });
      const { container } = render(
        <EventAttendance event={event({ groupId: 20 })} />,
      );
      expect(container).toBeEmptyDOMElement();
      expect(state.attendance).toHaveBeenLastCalledWith(31, false);
    });
  });

  it("shows nothing on another Group's Event", () => {
    const { container } = render(
      <EventAttendance event={event({ groupId: 20 })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('still shows a cancelled Event’s answers to its managers', async () => {
    await opened(event({ cancelledAt: '2030-09-30T10:00:00Z' }));
    expect(screen.getByText('2 participă · 1 nu')).toBeVisible();
  });

  it('says so when nobody has answered, with no list under it', async () => {
    answered([], []);
    await opened();
    expect(screen.getByText('Niciun răspuns încă')).toBeVisible();
    expect(screen.queryByRole('region', { name: /Particip/ })).toBeNull();
  });

  it('writes Nimeni under an empty group', async () => {
    answered(['m1'], []);
    await opened();
    expect(screen.getByText('1 participă · 0 nu')).toBeVisible();
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
    const user = await opened();
    expect(screen.getByText('Răspunsurile nu s-au încărcat.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Reîncearcă' }));
    expect(refetch).toHaveBeenCalled();
  });
});
