import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppointableMember } from '../../queries/groups-admin';

const state = vi.hoisted(() => ({
  caps: {} as Record<string, boolean>,
  team: {
    holderId: 'holder' as string | null,
    coordinatorId: null as string | null,
    responsibleId: null as string | null,
  },
  members: [] as AppointableMember[],
  mutate: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: () => ({ data: state.caps }),
  useCapability: (name: string) => ({ data: state.caps[name] === true }),
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

beforeEach(() => {
  state.members = [
    member('holder', 'Ana Titulara', 6),
    member('bce', 'Carmen BCE', 5),
    member('vol', 'Victor Voluntar', 2),
  ];
  state.team = { holderId: 'holder', coordinatorId: null, responsibleId: null };
  state.mutate.mockReset();
});

const pickers = () => screen.queryAllByRole('combobox');

describe('the OSUBB Deals team, per persona (R44)', () => {
  it('lets the holder pick both places', () => {
    state.caps = {
      manageDeals: true,
      manageDealsTeam: true,
      pickDealsCoordinator: true,
    };
    render(<DealsTeamPanel />);
    expect(screen.getByText('Ana Titulara')).toBeVisible();
    expect(pickers()).toHaveLength(2);
  });

  it('never shows an occupied place as free when its holder is not a candidate', () => {
    state.caps = {
      manageDeals: true,
      manageDealsTeam: true,
      pickDealsCoordinator: true,
    };
    state.team = { ...state.team, coordinatorId: 'bce' };
    // No longer a candidate (here: no longer BCE); the place is still taken.
    state.members = state.members.map((m) =>
      m.memberId === 'bce' ? { ...m, level: 4 } : m,
    );
    render(<DealsTeamPanel />);
    expect(pickers()[0]).toHaveTextContent('Carmen BCE');
    expect(screen.queryByText('Fără coordonator')).toBeNull();
  });

  it('lets the Coordonator pick the Responsabil only', () => {
    state.caps = { manageDeals: true, manageDealsTeam: true };
    state.team = { ...state.team, coordinatorId: 'bce' };
    render(<DealsTeamPanel />);
    expect(pickers()).toHaveLength(1);
    expect(screen.getByText('Carmen BCE')).toBeVisible();
  });

  it('shows the Responsabil names only, and the holder too', () => {
    state.caps = { manageDeals: true };
    state.team = {
      holderId: 'holder',
      coordinatorId: 'bce',
      responsibleId: 'vol',
    };
    render(<DealsTeamPanel />);
    expect(pickers()).toHaveLength(0);
    expect(screen.getByText('Ana Titulara')).toBeVisible();
    expect(screen.getByText('Carmen BCE')).toBeVisible();
    expect(screen.getByText('Victor Voluntar')).toBeVisible();
  });

  it('shows BC names only', () => {
    state.caps = { manageRoles: true, administer: true };
    render(<DealsTeamPanel />);
    expect(pickers()).toHaveLength(0);
    expect(screen.getAllByText('Neales')).toHaveLength(2);
  });

  // R44 amended 2026-10-08 — Alex: "I am a superuser as a moderator, so i
  // should be able to do anything a BC member could do". The Moderator's
  // capability row: every Atribuție's powers, without holding it.
  const MODERATOR = {
    manageRoles: true,
    administer: true,
    administerBc: true,
    manageDeals: true,
    manageDealsTeam: true,
    pickDealsCoordinator: true,
  };

  it('lets the Moderator pick both places without being on the team', () => {
    state.caps = MODERATOR;
    state.team = { ...state.team, coordinatorId: 'bce' };
    render(<DealsTeamPanel />);
    const [coordinator, responsible] = pickers();
    expect(pickers()).toHaveLength(2);
    expect(coordinator).toBeEnabled();
    expect(coordinator).toHaveTextContent('Carmen BCE');
    expect(responsible).toBeEnabled();
    expect(responsible).toHaveTextContent('Fără responsabil');
  });

  it('sets the Responsabil the Moderator picks', async () => {
    const user = userEvent.setup();
    state.caps = MODERATOR;
    state.mutate.mockImplementation(
      (_input: unknown, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
    );
    render(<DealsTeamPanel />);
    const responsible = pickers()[1];
    if (!responsible) throw new Error('no Responsabil picker');
    await user.click(responsible);
    await screen.findByPlaceholderText('Caută un membru');
    await user.click(screen.getByRole('option', { name: /Victor Voluntar/ }));
    expect(state.mutate).toHaveBeenCalledWith(
      { role: 'responsible', memberId: 'vol' },
      expect.anything(),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Victor Voluntar este acum Responsabil OSUBB Deals.',
    );
  });

  it('gives the Moderator no pickers while nobody holds the Atribuție', () => {
    state.caps = MODERATOR;
    state.team = { holderId: null, coordinatorId: null, responsibleId: null };
    render(<DealsTeamPanel />);
    expect(pickers()).toHaveLength(0);
    expect(screen.getByText('Fără titular')).toBeVisible();
  });

  it('offers BCE members alone as Coordonator and sets the one picked', async () => {
    const user = userEvent.setup();
    state.caps = {
      manageDeals: true,
      manageDealsTeam: true,
      pickDealsCoordinator: true,
    };
    state.mutate.mockImplementation(
      (_input: unknown, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
    );
    render(<DealsTeamPanel />);
    const [coordinatorPicker] = pickers();
    if (!coordinatorPicker) throw new Error('no Coordonator picker');
    await user.click(coordinatorPicker);
    await screen.findByPlaceholderText('Caută un membru');
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options.some((text) => text?.includes('Carmen BCE'))).toBe(true);
    expect(options.some((text) => text?.includes('Victor Voluntar'))).toBe(
      false,
    );
    expect(options.some((text) => text?.includes('Ana Titulara'))).toBe(false);
    await user.click(screen.getByRole('option', { name: /Carmen BCE/ }));
    expect(state.mutate).toHaveBeenCalledWith(
      { role: 'coordinator', memberId: 'bce' },
      expect.anything(),
    );
    const receipt = screen.getByRole('status');
    expect(receipt).toHaveTextContent(
      'Carmen BCE este acum Coordonator OSUBB Deals.',
    );
    expect(
      within(receipt).getByRole('button', {
        name: 'Profilul membrului Carmen BCE',
      }),
    ).toBeVisible();
  });
});
