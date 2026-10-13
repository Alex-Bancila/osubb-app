import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppointableMember } from '../../queries/groups-admin';

const state = vi.hoisted(() => ({
  caps: undefined as Record<string, boolean> | undefined,
  team: {
    coordinatorId: null as string | null,
    responsibleId: null as string | null,
  },
  members: [] as AppointableMember[],
  mutate: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: () => ({ data: state.caps }),
  useCapability: (name: string) => ({ data: state.caps?.[name] === true }),
}));
vi.mock('../../queries/deals', () => ({
  useDealsTeam: () => ({
    data: state.team,
    isPending: false,
    isError: false,
  }),
  useSetDealsTeamMember: () => ({ mutate: state.mutate, isPending: false }),
}));
vi.mock('../../queries/groups-admin', () => ({
  useAppointableMembers: () => ({ data: state.members, isPending: false }),
}));
vi.mock('../../queries/member-identities', () => ({
  useMemberIdentities: () => ({
    data: new Map(
      state.members.map((m) => [
        m.memberId,
        { memberId: m.memberId, fullName: m.name },
      ]),
    ),
  }),
}));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);

import { DealsTeamPanel } from './DealsTeamPanel';

function member(memberId: string, name: string, level: number) {
  return {
    memberId,
    name,
    nickname: null,
    avatarColor: null,
    status: 'activ',
    roleId: null,
    roleLabel: level === 5 ? 'BCE' : level === 6 ? 'BC' : 'Voluntar',
    level,
  } satisfies AppointableMember;
}

/* R47: a BC member's capability row -- every Deals power, no place needed. */
const BC = {
  manageRoles: true,
  administer: true,
  manageDeals: true,
  manageDealsTeam: true,
  pickDealsCoordinator: true,
};

beforeEach(() => {
  state.members = [
    member('bc', 'Bogdan BC', 6),
    member('bce', 'Carmen BCE', 5),
    member('vol', 'Victor Voluntar', 2),
  ];
  state.team = { coordinatorId: null, responsibleId: null };
  state.caps = BC;
  state.mutate.mockReset();
});

const pickers = () => screen.queryAllByRole('combobox');

describe('the OSUBB Deals team, per persona (R47)', () => {
  it('shows two places on one row, Coordonator and Responsabil, without hints', () => {
    render(<DealsTeamPanel />);
    const terms = screen.getAllByRole('term').map((term) => term.textContent);
    expect(terms).toEqual(['Coordonator', 'Responsabil']);
    expect(screen.queryByText(/Membru BCE/)).toBeNull();
    expect(screen.queryByText(/Orice membru activ/)).toBeNull();
    expect(screen.queryByText(/Atribuție BC/)).toBeNull();
    expect(screen.queryByText(/Responsabil OSUBB Deals/)).toBeNull();
    expect(document.querySelector('dl')).toHaveClass('sm:grid-cols-2');
  });

  it('lets a BC member pick both places and offers BCE members alone as Coordonator', async () => {
    const user = userEvent.setup();
    state.mutate.mockImplementation(
      (_input: unknown, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
    );
    render(<DealsTeamPanel />);
    const [coordinator, responsible] = pickers();
    expect(pickers()).toHaveLength(2);
    if (!coordinator || !responsible) throw new Error('two pickers expected');
    await user.click(coordinator);
    await screen.findByPlaceholderText('Caută un membru');
    expect(
      screen.getAllByRole('option').map((option) => option.textContent),
    ).toEqual(['Fără coordonator', expect.stringContaining('Carmen BCE')]);
    await user.click(screen.getByRole('option', { name: /Carmen BCE/ }));
    expect(state.mutate).toHaveBeenCalledWith(
      { role: 'coordinator', memberId: 'bce' },
      expect.anything(),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Carmen BCE este acum Coordonator OSUBB Deals.',
    );
  });

  it('lets the Coordonator pick the Responsabil only', () => {
    state.caps = { manageDeals: true, manageDealsTeam: true, administer: true };
    state.team = { coordinatorId: 'bce', responsibleId: null };
    render(<DealsTeamPanel />);
    expect(pickers()).toHaveLength(1);
    expect(screen.getByText('Carmen BCE')).toBeVisible();
    expect(pickers()[0]).toHaveTextContent('Fără responsabil');
  });

  it('shows the Responsabil names only', () => {
    state.caps = { manageDeals: true, administer: true };
    state.team = { coordinatorId: 'bce', responsibleId: 'vol' };
    render(<DealsTeamPanel />);
    expect(pickers()).toHaveLength(0);
    expect(screen.getByText('Carmen BCE')).toBeVisible();
    expect(screen.getByText('Victor Voluntar')).toBeVisible();
  });

  it('shows names only while the capability row is still loading', () => {
    state.caps = undefined;
    state.team = { coordinatorId: 'bce', responsibleId: null };
    render(<DealsTeamPanel />);
    expect(pickers()).toHaveLength(0);
    expect(screen.getByText('Carmen BCE')).toBeVisible();
    expect(screen.getByText('Neales')).toBeVisible();
  });

  it('keeps the other place out of a picker: the Coordonator is not offered as Responsabil', async () => {
    const user = userEvent.setup();
    state.team = { coordinatorId: 'bce', responsibleId: null };
    render(<DealsTeamPanel />);
    const responsible = pickers()[1];
    if (!responsible) throw new Error('no Responsabil picker');
    await user.click(responsible);
    await screen.findByPlaceholderText('Caută un membru');
    expect(
      screen.getAllByRole('option').map((option) => option.textContent),
    ).toEqual([
      'Fără responsabil',
      expect.stringContaining('Bogdan BC'),
      expect.stringContaining('Victor Voluntar'),
    ]);
  });
});
