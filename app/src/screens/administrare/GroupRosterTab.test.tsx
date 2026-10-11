import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AdminGroup,
  GroupAuthority,
  RosterEntry,
} from '../../queries/groups-admin';
import { GroupRosterTab } from './GroupRosterTab';

// #929 (ruling R32): the Membri tab lists every member of the Group -- its roster
// rows, its automatic members marked "Automat", and the membri de drept (BC
// and the Moderator) in their own list at the end -- and offers a removal only
// for a roster row.

const adunarea: AdminGroup = {
  id: 62,
  name: 'Adunarea Generală',
  short: null,
  color: null,
  category: 'team',
  path: [62],
  parent_id: null,
  min_level: 3,
  status: 'active',
  is_organization: false,
  manager_title: null,
  responsible_title: null,
  automatic_membership: true,
  accepts_applications: false,
  application_level: null,
  competes_in_cup: false,
  counts_toward_parent_cup: true,
  shared_work_visibility: false,
  is_private: false,
  application_form_label: null,
  application_form_url: null,
  memberCount: 5,
};

const everything: GroupAuthority = {
  manageWork: true,
  manageGroup: true,
  editStructure: true,
  appointManager: true,
  archive: true,
  editMinLevel: true,
};

function entry(
  memberId: string,
  name: string,
  source: RosterEntry['source'],
  extra: Partial<RosterEntry> = {},
): RosterEntry {
  return {
    memberId,
    name,
    avatarColor: null,
    groupRole: 'member',
    positionTitle: null,
    source,
    status: 'activ',
    roleId: 'vot',
    roleLabel: 'Voluntar cu Drept de Vot',
    level: 3,
    ...extra,
  };
}

const roster: RosterEntry[] = [
  entry('a', 'Alex Băncilă', 'roster', {
    groupRole: 'responsible',
    positionTitle: 'Responsabil Adunarea Generală',
    roleId: 'bce',
    roleLabel: 'BCE',
    level: 5,
  }),
  entry('m', 'Maria Dobre', 'automatic'),
  entry('r', 'Raluca Ionescu', 'automatic'),
  entry('c', 'Cristina Șerban', 'board', {
    roleId: 'bc',
    roleLabel: 'BC',
    level: 6,
  }),
  entry('o', 'Moderator OSUBB', 'board', {
    roleId: 'moderator',
    roleLabel: 'Moderator',
    level: 9,
  }),
];

function renderRoster(
  group: AdminGroup,
  rows: RosterEntry[],
  {
    authority = everything,
    onRun = vi.fn(),
  }: { authority?: GroupAuthority; onRun?: () => Promise<boolean> } = {},
) {
  return render(
    <MemoryRouter>
      <GroupRosterTab
        group={group}
        roster={rows}
        members={[]}
        authority={authority}
        busy={false}
        error={null}
        onRun={onRun}
      />
    </MemoryRouter>,
  );
}

it('marks the automatic members "Automat" and offers them no removal', () => {
  renderRoster(adunarea, roster);
  const table = screen.getByRole('table');
  const maria = within(table).getByRole('row', { name: /Maria Dobre/ });
  expect(within(maria).getByText('Automat')).toBeInTheDocument();
  expect(within(maria).queryByRole('button')).toBeNull();
  // A roster row keeps its Group Role.
  const alex = within(table).getByRole('row', { name: /Alex Băncilă/ });
  expect(
    within(alex).getByText('Responsabil Adunarea Generală'),
  ).toBeInTheDocument();
});

it('closes the roster with the membri de drept, named by Role, with no controls', () => {
  renderRoster(adunarea, roster);
  const table = screen.getByRole('table');
  expect(within(table).queryByText('Cristina Șerban')).toBeNull();
  const board = screen.getByRole('region', {
    name: 'Biroul de Conducere · membri de drept',
  });
  const rows = within(board).getAllByRole('listitem');
  expect(rows.map((row) => row.textContent)).toEqual([
    'CȘCristina ȘerbanBC',
    'MOModerator OSUBBModerator',
  ]);
  expect(within(board).queryByRole('button')).toBeNull();
  expect(
    within(board).getByRole('link', { name: 'Cristina Șerban' }),
  ).toHaveAttribute('href', '/administrare/membri/c');
});

it('names board members by their Board Title in Rol OSUBB and among the membri de drept (#963)', () => {
  renderRoster(adunarea, [
    entry('a', 'Alex Băncilă', 'roster', {
      groupRole: 'responsible',
      positionTitle: 'Responsabil Adunarea Generală',
      roleId: 'bce',
      roleLabel: 'Coordonator IT',
      level: 5,
    }),
    entry('m', 'Maria Dobre', 'automatic'),
    entry('c', 'Cristina Șerban', 'board', {
      roleId: 'bc',
      roleLabel: 'Președinte',
      level: 6,
    }),
  ]);
  const alex = within(screen.getByRole('table')).getByRole('row', {
    name: /Alex Băncilă/,
  });
  // The Group Role and the Board Title side by side, each in its column.
  expect(
    within(alex).getByText('Responsabil Adunarea Generală'),
  ).toBeInTheDocument();
  expect(within(alex).getByText('Coordonator IT')).toBeInTheDocument();
  const board = screen.getByRole('region', {
    name: 'Biroul de Conducere · membri de drept',
  });
  expect(
    within(board)
      .getAllByRole('listitem')
      .map((row) => row.textContent),
  ).toEqual(['CȘCristina ȘerbanPreședinte']);
});

it("names a Coordonator by their own function name, and an untitled one by the Group's (#967)", () => {
  const department: AdminGroup = {
    ...adunarea,
    id: 8,
    name: 'Educațional',
    category: 'department',
    min_level: 0,
    automatic_membership: false,
    manager_title: 'Vicepreședinte',
  };
  renderRoster(department, [
    entry('v', 'Vlad Marin', 'roster', {
      groupRole: 'manager',
      positionTitle: 'Vicepreședinte Educațional',
    }),
    entry('w', 'Wanda Pop', 'roster', { groupRole: 'manager' }),
  ]);
  const table = screen.getByRole('table');
  expect(
    within(within(table).getByRole('row', { name: /Vlad Marin/ })).getByText(
      'Vicepreședinte Educațional',
    ),
  ).toBeInTheDocument();
  expect(
    within(within(table).getByRole('row', { name: /Wanda Pop/ })).getByText(
      'Vicepreședinte',
    ),
  ).toBeInTheDocument();
});

it('offers a roster member of a plain Group a removal, and never a membru de drept', () => {
  const team = {
    ...adunarea,
    id: 9,
    name: 'Echipa IT',
    automatic_membership: false,
    min_level: 0,
  };
  renderRoster(team, [
    entry('v', 'Vlad Constantin', 'roster', {
      roleId: 'activ',
      roleLabel: 'Voluntar Activ',
      level: 2,
    }),
    entry('c', 'Cristina Șerban', 'board', { roleLabel: 'BC', level: 6 }),
  ]);
  expect(
    screen.getByRole('button', { name: 'Scoate pe Vlad Constantin din grup' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Cristina Șerban/ })).toBeNull();
});

it('shows no membri de drept list when the Group has none to show', () => {
  renderRoster(adunarea, roster.slice(0, 3));
  expect(
    screen.queryByRole('region', {
      name: 'Biroul de Conducere · membri de drept',
    }),
  ).toBeNull();
});

it('names each Member with a link in the text colour, and heads the membri de drept without capitals', () => {
  renderRoster(adunarea, roster);
  for (const link of screen.getAllByRole('link')) {
    expect(link).toHaveClass('text-foreground', 'no-underline', 'min-h-11');
    expect(link).not.toHaveClass('underline');
  }
  expect(
    screen.getByRole('heading', {
      name: 'Biroul de Conducere · membri de drept',
    }),
  ).toHaveAttribute('data-variant', 'label');
  // The table lets the name shorten rather than push the box sideways.
  expect(screen.getByRole('columnheader', { name: /Nume/ })).toHaveClass(
    'w-full',
    'max-w-0',
  );
});

/*
 * Under 1280 px the five columns do not fit beside the sidebar: each Member
 * is a list row, and nothing scrolls sideways.
 */
describe('under the width its columns fit', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const team: AdminGroup = {
    ...adunarea,
    id: 9,
    name: 'Echipa IT',
    automatic_membership: false,
    min_level: 0,
    manager_title: 'Coordonator',
  };
  const members = [
    entry('z', 'Zoe Albu', 'roster', {
      roleId: 'activ',
      roleLabel: 'Voluntar Activ',
      status: 'inactiv',
    }),
    entry('a', 'Alex Băncilă', 'roster', {
      groupRole: 'manager',
      roleId: 'bce',
      roleLabel: 'BCE',
    }),
    entry('m', 'Maria Dobre', 'automatic'),
    entry('c', 'Cristina Șerban', 'board', { roleLabel: 'BC', level: 6 }),
  ];

  it('lists the Members as rows, in name order, with no table to scroll', () => {
    const { container } = renderRoster(team, members);
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 80rem)');
    expect(screen.queryByRole('table')).toBeNull();
    expect(container.querySelector('[data-slot="table-container"]')).toBeNull();
    const panel = screen.getByRole('region', { name: 'Membrii grupului' });
    const rows = within(
      within(panel).getAllByRole('list')[0] as HTMLElement,
    ).getAllByRole('listitem');
    // Avatar, name, the function as a chip, then Role · Status on one line.
    expect(rows.map((row) => row.textContent)).toEqual([
      'ABAlex BăncilăCoordonatorBCE · Activ · Retrage întâi funcția',
      'MDMaria DobreAutomatVoluntar cu Drept de Vot · Activ',
      'ZAZoe AlbuMembruVoluntar Activ · Inactiv',
    ]);
    const zoe = rows[2] as HTMLElement;
    expect(
      within(zoe).getByText('Membru').closest('[data-slot="badge"]'),
    ).not.toBeNull();
    expect(within(zoe).getByRole('link', { name: 'Zoe Albu' })).toHaveAttribute(
      'href',
      '/administrare/membri/z',
    );
    // The membri de drept keep their own list under the rows.
    expect(
      within(
        screen.getByRole('region', {
          name: 'Biroul de Conducere · membri de drept',
        }),
      ).getByRole('link', { name: 'Cristina Șerban' }),
    ).toHaveAttribute('href', '/administrare/membri/c');
  });

  it('keeps the removal behind the row’s "⋯", only where the table offers it', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn().mockResolvedValue(true);
    renderRoster(team, members, { onRun });
    // A Coordonator is demoted first; an automatic member follows their Role.
    expect(
      screen.queryByRole('button', { name: 'Acțiuni pentru Alex Băncilă' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Acțiuni pentru Maria Dobre' }),
    ).toBeNull();
    const more = screen.getByRole('button', {
      name: 'Acțiuni pentru Zoe Albu',
    });
    expect(more).toHaveAttribute('data-slot', 'action-menu');
    await user.click(more);
    await user.click(
      await screen.findByRole('menuitem', { name: 'Scoate din grup' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Scoate pe Zoe Albu',
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Scoate din grup' }),
    );
    expect(onRun).toHaveBeenCalledWith({
      kind: 'removeMember',
      groupId: 9,
      memberId: 'z',
    });
    // The pop-up hands focus back to the row's "⋯", not to the page.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Acțiuni pentru Zoe Albu' }),
      ).toHaveFocus(),
    );
  });

  it('offers no "⋯" and no hint to a viewer who cannot manage the Group', () => {
    renderRoster(team, members, {
      authority: { ...everything, manageWork: false },
    });
    expect(screen.queryByRole('button', { name: /Acțiuni pentru/ })).toBeNull();
    expect(screen.queryByText(/Retrage întâi funcția/)).toBeNull();
  });

  it('says so when the Group has no Members yet', () => {
    renderRoster(team, []);
    expect(
      screen.getByText('Grupul nu are încă membri adăugați.'),
    ).toBeVisible();
  });
});
