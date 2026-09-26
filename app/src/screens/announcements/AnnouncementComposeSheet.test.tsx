import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyGroup } from '../../queries/my-groups';
import type { Group } from '../../queries/reference';

const mock = vi.hoisted(() => ({
  capabilities: vi.fn(),
  roles: vi.fn(),
  groups: vi.fn(),
  create: vi.fn(),
}));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'member-1' } } }),
}));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: mock.capabilities,
}));
vi.mock('../../queries/my-groups', () => ({ useMyGroupRoles: mock.roles }));
vi.mock('../../queries/reference', () => ({ useGroups: mock.groups }));
vi.mock('../../queries/announcements', () => ({
  useCreateAnnouncement: mock.create,
}));

import AnnouncementComposeSheet from './AnnouncementComposeSheet';
import { announcementOrigins } from './announcement-origins';

function group(
  id: number,
  name: string,
  path: number[],
  organization = false,
): Group {
  return {
    id,
    name,
    short: name,
    color: null,
    category: organization ? 'organization' : 'team',
    path,
    parent_id: path.length > 1 ? (path[path.length - 2] ?? null) : null,
    min_level: 0,
    status: 'active',
    is_organization: organization,
  };
}
function role(g: Group, groupRole: string): MyGroup {
  return {
    id: g.id,
    name: g.name,
    short: g.short ?? '',
    color: '',
    category: g.category,
    path: g.path,
    min_level: g.min_level,
    status: g.status,
    is_organization: g.is_organization,
    group_role: groupRole,
    explicit: true,
    automatic: false,
  };
}
const organization = group(1, 'OSUBB', [1], true);
const team = group(2, 'Echipa A', [1, 2]);
const child = group(3, 'Proiect A', [1, 2, 3]);
const unrelated = group(4, 'Echipa B', [1, 4]);
const allGroups = [organization, team, child, unrelated];
const responsibleRoles = [
  role(organization, 'member'),
  role(team, 'responsible'),
  role(child, 'responsible'),
];

describe('Announcement composer', () => {
  const mutateAsync = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    mock.capabilities.mockReturnValue({
      data: { managesAnyGroup: true, createTopLevelGroups: false },
    });
    mock.roles.mockReturnValue({
      data: responsibleRoles,
      isPending: false,
      isError: false,
    });
    mock.groups.mockReturnValue({
      data: new Map(allGroups.map((g) => [g.id, g])),
      isPending: false,
      isError: false,
    });
    mock.create.mockReturnValue({ mutateAsync, isPending: false });
    mutateAsync.mockResolvedValue(undefined);
  });

  it('offers a Responsible only their Team, inherited Child, and Organization Origin', () => {
    expect(
      announcementOrigins(allGroups, responsibleRoles, false).map(
        (g) => g.name,
      ),
    ).toEqual(['OSUBB', 'Echipa A', 'Proiect A']);
    expect(
      announcementOrigins(allGroups, responsibleRoles, true).map((g) => g.name),
    ).toEqual(['OSUBB', 'Echipa A', 'Echipa B', 'Proiect A']);
  });

  it('posts the selected Origin and organization Audience without requesting a returned row', async () => {
    const user = userEvent.setup();
    render(<AnnouncementComposeSheet />);
    await user.click(screen.getByRole('button', { name: 'Anunț nou' }));
    const dialog = screen.getByRole('dialog', { name: 'Anunț nou' });
    expect(
      within(dialog).queryByRole('option', { name: 'Echipa B' }),
    ).not.toBeInTheDocument();
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Titlu' }),
      'Ședință',
    );
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Mesaj' }),
      'Vineri la 18:00',
    );
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Grup de origine' }),
      '2',
    );
    await user.click(
      within(dialog).getByRole('radio', { name: 'Toată organizația' }),
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Publică anunțul' }),
    );
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Ședință',
        body: 'Vineri la 18:00',
        group_id: 2,
        audience: 'org',
        created_by: 'member-1',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Anunțul a fost publicat.',
    );
  });

  it('explains a database refusal without losing the draft', async () => {
    mutateAsync.mockRejectedValue({ code: '42501' });
    const user = userEvent.setup();
    render(<AnnouncementComposeSheet />);
    await user.click(screen.getByRole('button', { name: 'Anunț nou' }));
    const dialog = screen.getByRole('dialog', { name: 'Anunț nou' });
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Titlu' }),
      'Titlu',
    );
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Mesaj' }),
      'Mesaj',
    );
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Grup de origine' }),
      '2',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Publică anunțul' }),
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Nu ai permisiunea',
    );
    expect(within(dialog).getByRole('textbox', { name: 'Titlu' })).toHaveValue(
      'Titlu',
    );
  });

  it('rejects whitespace-only content and incomplete or non-web form links', async () => {
    const user = userEvent.setup();
    render(<AnnouncementComposeSheet />);
    await user.click(screen.getByRole('button', { name: 'Anunț nou' }));
    const dialog = screen.getByRole('dialog', { name: 'Anunț nou' });
    const title = within(dialog).getByRole('textbox', { name: 'Titlu' });
    const message = within(dialog).getByRole('textbox', { name: 'Mesaj' });
    const formName = within(dialog).getByRole('textbox', {
      name: 'Etichetă link',
    });
    const formUrl = within(dialog).getByRole('textbox', {
      name: 'Adresă link',
    });
    const publish = within(dialog).getByRole('button', {
      name: 'Publică anunțul',
    });
    await user.type(title, '   ');
    await user.type(message, 'Text');
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Grup de origine' }),
      '2',
    );
    await user.click(publish);
    expect(title).toHaveAccessibleDescription('Scrie titlul.');
    expect(title).toHaveFocus();
    expect(mutateAsync).not.toHaveBeenCalled();
    await user.clear(title);
    await user.type(title, 'Anunț');
    await user.type(formName, 'Formular');
    await user.click(publish);
    expect(formUrl).toHaveAccessibleDescription(
      'Scrie adresa linkului sau lasă linkul gol.',
    );
    await user.type(formUrl, 'ftp://example.com');
    await user.click(publish);
    expect(formUrl).toHaveAccessibleDescription(
      'Adresa trebuie să înceapă cu http:// sau https://.',
    );
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('hides publishing when the server capability says no', () => {
    mock.capabilities.mockReturnValue({
      data: { managesAnyGroup: false, createTopLevelGroups: false },
    });
    render(<AnnouncementComposeSheet />);
    expect(
      screen.queryByRole('button', { name: 'Anunț nou' }),
    ).not.toBeInTheDocument();
  });

  it('closes on Escape and returns keyboard focus to the compose button', async () => {
    const user = userEvent.setup();
    render(<AnnouncementComposeSheet />);
    const trigger = screen.getByRole('button', { name: 'Anunț nou' });
    await user.click(trigger);
    expect(
      screen.getByRole('dialog', { name: 'Anunț nou' }),
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('dialog', { name: 'Anunț nou' }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('has accessible form labels and no structural axe violations', async () => {
    const user = userEvent.setup();
    render(<AnnouncementComposeSheet />);
    await user.click(screen.getByRole('button', { name: 'Anunț nou' }));
    const result = await axe.run(document.body, {
      runOnly: [
        'label',
        'aria-required-attr',
        'aria-valid-attr',
        'aria-dialog-name',
        'button-name',
      ],
    });
    expect(result.violations).toEqual([]);
  });
});
