import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppointableMember } from '../../queries/groups-admin';

const state = vi.hoisted(() => ({
  members: [] as AppointableMember[],
  holders: new Map<string, string>(),
  mutate: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/groups-admin', () => ({
  useAppointableMembers: () => ({
    data: state.members,
    isPending: false,
    isError: false,
  }),
}));
vi.mock('../../queries/bc-assignments', async () => {
  const actual = await vi.importActual<
    typeof import('../../queries/bc-assignments')
  >('../../queries/bc-assignments');
  return {
    ...actual,
    useAssignmentHolders: () => ({
      data: state.holders,
      isPending: false,
      isError: false,
    }),
    useSetBcAssignment: () => ({ mutate: state.mutate, isPending: false }),
  };
});
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);

import AdminBcTab from './AdminBcTab';

function member(
  memberId: string,
  name: string,
  level: number,
  status = 'activ',
): AppointableMember {
  return {
    memberId,
    name,
    nickname: null,
    avatarColor: null,
    status,
    roleId: null,
    roleLabel: '',
    level,
  };
}

beforeEach(() => {
  state.members = [
    member('ana', 'Ana Pop', 6),
    member('bogdan', 'Bogdan Ilie', 6),
    member('old', 'Fost BC', 6, 'inactiv'),
    member('bce', 'Carmen BCE', 5),
    member('mod', 'Moderator', 9),
  ];
  state.holders = new Map();
  state.mutate.mockReset();
  state.mutate.mockImplementation(
    (_input: unknown, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
  );
});

const list = () => screen.getByRole('list', { name: 'Membrii BC' });
const open = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole('button', { name: `Atribuțiile lui ${name}` }));

describe('Administrare BC (R44)', () => {
  it('lists the active BC members only, each with what they hold', () => {
    state.holders = new Map([['osubb_deals', 'ana']]);
    render(<AdminBcTab />);
    const rows = within(list()).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Ana Pop');
    expect(rows[0]).toHaveTextContent('Responsabil OSUBB Deals');
    expect(rows[1]).toHaveTextContent('Bogdan Ilie');
    expect(rows[1]).toHaveTextContent('Nicio atribuție');
    expect(screen.queryByText('Carmen BCE')).toBeNull();
    expect(screen.queryByText('Fost BC')).toBeNull();
  });

  it('opens a member into their Atribuții as checkboxes, and gives a free one at once', async () => {
    const user = userEvent.setup();
    render(<AdminBcTab />);
    const toggle = screen.getByRole('button', {
      name: 'Atribuțiile lui Bogdan Ilie',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const box = screen.getByRole('checkbox', {
      name: /Responsabil OSUBB Deals/,
    });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(state.mutate).toHaveBeenCalledWith(
      { assignment: 'osubb_deals', memberId: 'bogdan', granted: true },
      expect.anything(),
    );
    expect(
      screen.getByText(
        'Bogdan Ilie are acum atribuția Responsabil OSUBB Deals.',
      ),
    ).toBeVisible();
  });

  it('asks before moving an Atribuție another BC member holds', async () => {
    const user = userEvent.setup();
    state.holders = new Map([['osubb_deals', 'ana']]);
    render(<AdminBcTab />);
    await open(user, 'Bogdan Ilie');
    expect(screen.getByText('Acum la Ana Pop')).toBeVisible();
    await user.click(
      screen.getByRole('checkbox', { name: /Responsabil OSUBB Deals/ }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Muți atribuția de la Ana Pop la Bogdan Ilie?',
    });
    expect(state.mutate).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole('button', { name: 'Mută atribuția' }),
    );
    expect(state.mutate).toHaveBeenCalledWith(
      {
        assignment: 'osubb_deals',
        memberId: 'bogdan',
        granted: true,
        move: true,
      },
      expect.anything(),
    );
    expect(
      screen.getByText('Responsabil OSUBB Deals a fost mutată la Bogdan Ilie.'),
    ).toBeVisible();
  });

  it('asks before taking an Atribuție back, saying the team dissolves and the Deals stay', async () => {
    const user = userEvent.setup();
    state.holders = new Map([['osubb_deals', 'ana']]);
    render(<AdminBcTab />);
    await open(user, 'Ana Pop');
    const box = screen.getByRole('checkbox', {
      name: /Responsabil OSUBB Deals/,
    });
    expect(box).toBeChecked();
    await user.click(box);
    const dialog = screen.getByRole('dialog', { name: 'Retragi atribuția?' });
    expect(dialog).toHaveTextContent('Echipa se dizolvă; deal-urile rămân.');
    await user.click(
      within(dialog).getByRole('button', { name: 'Retrage atribuția' }),
    );
    expect(state.mutate).toHaveBeenCalledWith(
      { assignment: 'osubb_deals', memberId: 'ana', granted: false },
      expect.anything(),
    );
  });

  it('changes nothing when the Moderator cancels', async () => {
    const user = userEvent.setup();
    state.holders = new Map([['osubb_deals', 'ana']]);
    render(<AdminBcTab />);
    await open(user, 'Ana Pop');
    await user.click(
      screen.getByRole('checkbox', { name: /Responsabil OSUBB Deals/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Renunță' }));
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('says why the server refused', async () => {
    const user = userEvent.setup();
    state.mutate.mockImplementation(
      (_input: unknown, options?: { onError?: (e: unknown) => void }) =>
        options?.onError?.({ code: 'PT400', message: 'bc_assignment_not_bc' }),
    );
    render(<AdminBcTab />);
    await open(user, 'Bogdan Ilie');
    await user.click(
      screen.getByRole('checkbox', { name: /Responsabil OSUBB Deals/ }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'O atribuție se dă doar unui membru BC activ.',
    );
  });
});
