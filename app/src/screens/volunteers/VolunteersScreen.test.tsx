import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DirectoryGroup,
  DirectoryMember,
} from '../../queries/member-directory';
import VolunteersScreen from './VolunteersScreen';

const mock = vi.hoisted(() => ({
  useMemberDirectory: vi.fn(),
  useGroups: vi.fn(),
  useMemberCard: vi.fn(),
}));
vi.mock('../../queries/member-directory', () => ({
  useMemberDirectory: mock.useMemberDirectory,
}));
vi.mock('../../queries/reference', () => ({ useGroups: mock.useGroups }));
vi.mock('../../queries/member-card', () => ({
  useMemberCard: mock.useMemberCard,
}));
vi.mock('../../lib/capabilities', () => ({
  useCapability: () => ({ data: false }),
}));

// Group tree: Educațional ⟶ Logistică, Mentorat; Imagine & PR ⟶ Foto;
// plus a few top-level Projects so one member can sit in many Groups.
const tree = [
  { id: 1, name: 'Educațional', path: [1], category: 'department' },
  { id: 2, name: 'Logistică', path: [1, 2], category: 'team' },
  { id: 3, name: 'Mentorat', path: [1, 3], category: 'team' },
  { id: 4, name: 'Imagine & PR', path: [4], category: 'department' },
  { id: 5, name: 'Foto', path: [4, 5], category: 'team' },
  { id: 6, name: 'Balul Bobocilor', path: [6], category: 'project' },
  { id: 7, name: 'Zilele Studenților', path: [7], category: 'project' },
  { id: 8, name: 'Voluntariat de iarnă', path: [8], category: 'project' },
].map((group) => ({ ...group, status: 'active', is_organization: false }));
const byId = new Map(tree.map((group) => [group.id, group]));
function g(id: number): DirectoryGroup {
  const group = byId.get(id) as (typeof tree)[number];
  const parent = byId.get(group.path.at(-2) ?? -1);
  return {
    id,
    name: group.name,
    label: parent ? `${group.name} · ${parent.name}` : group.name,
    category: group.category,
    path: group.path,
  };
}

const members: DirectoryMember[] = [
  {
    id: 'a',
    name: 'Ștefan Pop',
    nickname: null,
    avatarColor: null,
    roleId: 'voluntar',
    role: 'Voluntar',
    roleLevel: 1,
    status: 'activ',
    groups: [g(2)],
    points: -2,
    contact: { email: 'stefan@example.test', phone: null },
  },
  {
    id: 'b',
    name: 'Ana Ionescu',
    nickname: null,
    avatarColor: '#284C93',
    roleId: 'bc',
    role: 'BC',
    roleLevel: 6,
    status: 'inactiv',
    groups: [g(4)],
    points: 0,
    contact: undefined,
  },
  {
    // A member in many Groups: the row must stay one readable line.
    id: 'c',
    name: 'Maria Dobre',
    nickname: null,
    avatarColor: null,
    roleId: 'vot',
    role: 'Membru cu Drept de Vot',
    roleLevel: 3,
    status: 'activ',
    groups: [g(1), g(4), g(3), g(5), g(6), g(7), g(8)],
    points: 40,
    contact: { email: 'maria@example.test', phone: '0700' },
  },
];
function result(overrides = {}) {
  return {
    data: members,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  };
}
function rowOf(name: string) {
  return screen
    .getByRole('button', { name: `Profilul membrului ${name}` })
    .closest('tr') as HTMLElement;
}
function names() {
  return screen
    .getAllByRole('row', { hidden: true })
    .slice(1)
    .map((row) => row.querySelector('td button span.truncate')?.textContent);
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.useMemberDirectory.mockReturnValue(result());
  mock.useGroups.mockReturnValue({ data: byId, isError: false });
  mock.useMemberCard.mockImplementation((id: string) => ({
    data: {
      memberId: id,
      nickname: null,
      fullName: members.find((member) => member.id === id)?.name ?? '',
      avatarColor: null,
      roleLabel: null,
      joinedAt: null,
      primaryGroup: null,
      otherMemberships: 0,
      groups: (members.find((member) => member.id === id)?.groups ?? []).map(
        (group) => ({
          id: group.id,
          name: group.name,
          label: group.label,
          color: null,
          roleLabel: 'Membru',
        }),
      ),
      contact: null,
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }));
});

describe('Member directory', () => {
  it('searches names without diacritics, and Group names too', async () => {
    const user = userEvent.setup();
    render(<VolunteersScreen />);
    const search = screen.getByRole('searchbox', { name: 'Caută un membru' });
    await user.type(search, 'stefan');
    expect(names()).toEqual(['Ștefan Pop']);
    await user.clear(search);
    await user.type(search, 'foto');
    expect(names()).toEqual(['Maria Dobre']);
    expect(screen.getByRole('status')).toHaveTextContent('1 din 3 membri');
  });

  it('keeps a member with many Groups on one readable line and lists the rest', async () => {
    const user = userEvent.setup();
    render(<VolunteersScreen />);
    const row = rowOf('Maria Dobre');
    // Two chips, then "+5" naming the other five.
    expect(within(row).getByText('Educațional')).toBeVisible();
    expect(within(row).getByText('Imagine & PR')).toBeVisible();
    expect(within(row).queryByText('Foto · Imagine & PR')).toBeNull();
    const more = within(row).getByRole('button', { name: /^\+5 grupuri/ });
    expect(more).toHaveTextContent('+5');
    expect(more).toHaveAccessibleName(
      '+5 grupuri: Mentorat · Educațional, Foto · Imagine & PR, Balul Bobocilor, Zilele Studenților, Voluntariat de iarnă. Vezi profilul membrului Maria Dobre',
    );
    expect(more.title.split('\n')).toHaveLength(5);
    // Every chip truncates instead of stretching the row.
    for (const chip of within(row).getAllByTitle(/./))
      if (chip !== more) expect(chip.className).toContain('truncate');

    await user.click(more);
    const dialog = await screen.findByRole('dialog', { name: 'Maria Dobre' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(7);
    // The row shows 40 points; the Member Card never does.
    expect(dialog).not.toHaveTextContent('puncte');
  });

  it('opens the Member Card from the name, with the full name under a Nickname', async () => {
    const user = userEvent.setup();
    mock.useMemberDirectory.mockReturnValue(
      result({
        data: members.map((member) =>
          member.id === 'b' ? { ...member, nickname: 'Ani' } : member,
        ),
      }),
    );
    render(<VolunteersScreen />);
    const button = screen.getByRole('button', {
      name: 'Profilul membrului Ani',
    });
    // Ruling R5: Voluntari shows the full name underneath the Nickname.
    expect(button).toHaveTextContent('AniAna Ionescu');
    await user.click(button);
    expect(await screen.findByRole('dialog', { name: 'Ana Ionescu' })).toBe(
      screen.getByRole('dialog'),
    );
    expect(mock.useMemberCard).toHaveBeenCalledWith('b');
  });

  it('adds Group, role and status filters in a Dialog and shows them as removable chips', async () => {
    const user = userEvent.setup();
    render(<VolunteersScreen />);
    await user.click(screen.getByRole('button', { name: 'Filtrează' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Filtrează membrii',
    });

    // A parent Group finds the members of its Child Groups too: Ștefan is
    // only in Logistică, under Educațional.
    await user.click(within(dialog).getByRole('combobox', { name: 'Grup' }));
    await user.type(
      await screen.findByPlaceholderText('Caută un grup'),
      'educ',
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('listbox'))
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual([
        'Educațional',
        'Logistică· Educațional',
        'Mentorat· Educațional',
      ]),
    );
    await user.click(screen.getByRole('option', { name: 'Educațional' }));
    expect(names()).toEqual(['Maria Dobre', 'Ștefan Pop']);

    await user.click(within(dialog).getByRole('button', { name: 'Voluntar' }));
    expect(
      within(dialog).getByRole('button', { name: 'Voluntar' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(names()).toEqual(['Ștefan Pop']);

    await user.click(within(dialog).getByRole('button', { name: 'Gata' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const active = screen.getByRole('list', { name: 'Filtre active' });
    expect(within(active).getAllByRole('button')).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: /Filtrează.*2 filtre active/ }),
    ).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Elimină filtrul Rol: Voluntar' }),
    );
    expect(names()).toEqual(['Maria Dobre', 'Ștefan Pop']);

    await user.click(screen.getByRole('button', { name: 'Șterge filtrele' }));
    expect(names()).toHaveLength(3);
    expect(screen.queryByRole('list', { name: 'Filtre active' })).toBeNull();
  });

  it('filters by status and says so when nothing matches', async () => {
    const user = userEvent.setup();
    render(<VolunteersScreen />);
    await user.click(screen.getByRole('button', { name: 'Filtrează' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Inactiv' }));
    expect(names()).toEqual(['Ana Ionescu']);
    await user.click(within(dialog).getByRole('button', { name: 'Voluntar' }));
    expect(
      screen.getByText('Niciun membru nu corespunde filtrelor.'),
    ).toBeVisible();
  });

  it('switches to a card view with the same members and filters', async () => {
    const user = userEvent.setup();
    render(<VolunteersScreen />);
    await user.click(screen.getByRole('button', { name: 'Carduri' }));
    expect(screen.getByRole('button', { name: 'Carduri' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('table')).toBeNull();
    expect(
      screen.getAllByRole('button', { name: /^\+4 grupuri/ }),
    ).toHaveLength(1);
    await user.type(
      screen.getByRole('searchbox', { name: 'Caută un membru' }),
      'ana',
    );
    expect(
      screen.getByRole('button', { name: 'Profilul membrului Ana Ionescu' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Profilul membrului Maria Dobre' }),
    ).toBeNull();
  });

  it('shows negative and zero Task points and view-provided contacts', () => {
    render(<VolunteersScreen />);
    expect(screen.getByText('−2')).toBeVisible();
    expect(screen.getByText('0')).toBeVisible();
    expect(screen.getByText('stefan@example.test')).toBeVisible();
    expect(screen.getByText('Inactiv')).toBeVisible();
  });

  it('does not invent contact columns when the protected view returns no contact rows', () => {
    mock.useMemberDirectory.mockReturnValue(
      result({
        data: members.map((member) => ({ ...member, contact: undefined })),
      }),
    );
    render(<VolunteersScreen />);
    expect(
      screen.queryByRole('columnheader', { name: /Email/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: /Telefon/ }),
    ).not.toBeInTheDocument();
  });

  it('offers retry on a failed read without displaying raw database errors', async () => {
    const query = result({ isError: true, data: undefined });
    mock.useMemberDirectory.mockReturnValue(query);
    render(<VolunteersScreen />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Încearcă din nou' }),
    );
    expect(query.refetch).toHaveBeenCalledOnce();
  });

  it('has loading and empty states', () => {
    mock.useMemberDirectory.mockReturnValue(result({ isPending: true }));
    const view = render(<VolunteersScreen />);
    expect(screen.getByText('Se încarcă membrii…')).toBeVisible();
    mock.useMemberDirectory.mockReturnValue(result({ data: [] }));
    view.rerender(<VolunteersScreen />);
    expect(screen.getByText('Niciun membru disponibil.')).toBeVisible();
  });

  it('sorts Task points numerically and roles by seniority', async () => {
    const user = userEvent.setup();
    render(<VolunteersScreen />);
    await user.click(
      screen.getByRole('button', {
        name: 'Sortează Puncte din taskuri crescător',
      }),
    );
    expect(names()[0]).toContain('Ștefan Pop');
    await user.click(
      screen.getByRole('button', { name: 'Sortează Rol crescător' }),
    );
    expect(names()).toEqual(['Ștefan Pop', 'Maria Dobre', 'Ana Ionescu']);
  });

  it('has no automated accessibility violations in either view or the filter Dialog', async () => {
    const user = userEvent.setup();
    const { container } = render(<VolunteersScreen />);
    const rules = { 'color-contrast': { enabled: false } };
    expect((await axe.run(container, { rules })).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Carduri' }));
    expect((await axe.run(container, { rules })).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Filtrează' }));
    const dialog = await screen.findByRole('dialog');
    expect((await axe.run(dialog, { rules })).violations).toEqual([]);
  });
});
