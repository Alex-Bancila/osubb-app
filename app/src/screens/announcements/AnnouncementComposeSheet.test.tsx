import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseOption } from '../../test/select';
import type { MyGroup } from '../../queries/my-groups';
import type { Group } from '../../queries/reference';

const mock = vi.hoisted(() => ({
  capabilities: vi.fn(),
  roles: vi.fn(),
  groups: vi.fn(),
  create: vi.fn(),
}));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    session: { user: { id: 'member-1' } },
    claims: { member_level: 3 },
  }),
}));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: mock.capabilities,
}));
vi.mock('../../queries/my-groups', () => ({ useMyGroupRoles: mock.roles }));
vi.mock('../../queries/reference', () => ({ useGroups: mock.groups }));
vi.mock('../../queries/announcements', () => ({
  useCreateAnnouncement: mock.create,
}));

import {
  bucharestDayKey,
  bucharestWallTimeToIso,
} from '../../lib/calendar-time';
import { pickDate } from '../../test/date-picker';
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

// Typing a whole draft with user-event takes seconds on a loaded runner.
vi.setConfig({ testTimeout: 15_000 });

/**
 * The 15th of a month near today, as a picker value: one press of "Luna
 * următoare" / "Luna anterioară" away, where a fixed far date is dozens.
 */
function nearDate(months: number, time: string) {
  const [year = 1970, month = 1] = (bucharestDayKey(new Date()) ?? '')
    .split('-')
    .map(Number);
  const day = new Date(Date.UTC(year, month - 1 + months, 15));
  return `${day.toISOString().slice(0, 10)}T${time}`;
}

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
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Titlu' }),
      'Ședință',
    );
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Mesaj' }),
      'Vineri la 18:00',
    );
    // The list holds only the Groups the author may publish from.
    await user.click(
      within(dialog).getByRole('combobox', { name: 'Grup de origine' }),
    );
    expect(
      (await screen.findAllByRole('option')).map(
        (option) => option.textContent,
      ),
    ).toEqual(['OSUBB', 'Echipa A', 'Proiect A']);
    await user.click(screen.getByRole('option', { name: 'Echipa A' }));
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
        // No Termen typed: the Announcement has none (#909).
        deadline: null,
        // Everyone in the Audience unless a Minimum Level is chosen (#909).
        min_level: 0,
      }),
    );
    // The server stamps the author and the date (security pass M1).
    expect(mutateAsync.mock.calls[0]?.[0]).not.toHaveProperty('created_by');
    expect(mutateAsync.mock.calls[0]?.[0]).not.toHaveProperty('published_at');
    // A level-3 writer speaking to the whole organisation: the server leaves
    // the row pending, and the receipt says so (spec 2026-10-11).
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Anunțul așteaptă aprobarea BC.',
    );
  });

  it('says the Announcement is published when it stays in its own Group (spec 2026-10-11)', async () => {
    const user = userEvent.setup();
    render(<AnnouncementComposeSheet />);
    await user.click(screen.getByRole('button', { name: 'Anunț nou' }));
    const dialog = screen.getByRole('dialog', { name: 'Anunț nou' });
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Titlu' }),
      'Ședință',
    );
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Mesaj' }),
      'Vineri la 18:00',
    );
    await user.click(
      within(dialog).getByRole('combobox', { name: 'Grup de origine' }),
    );
    await user.click(await screen.findByRole('option', { name: 'Echipa A' }));
    await user.click(
      within(dialog).getByRole('button', { name: 'Publică anunțul' }),
    );
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ group_id: 2, audience: 'local' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Anunțul a fost publicat.',
    );
  });

  it('says the Announcement waits for BC when its Origin is the Organization Group (spec 2026-10-11)', async () => {
    const user = userEvent.setup();
    render(<AnnouncementComposeSheet />);
    await user.click(screen.getByRole('button', { name: 'Anunț nou' }));
    const dialog = screen.getByRole('dialog', { name: 'Anunț nou' });
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Titlu' }),
      'Ședință',
    );
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Mesaj' }),
      'Vineri la 18:00',
    );
    await user.click(
      within(dialog).getByRole('combobox', { name: 'Grup de origine' }),
    );
    await user.click(await screen.findByRole('option', { name: 'OSUBB' }));
    await user.click(
      within(dialog).getByRole('button', { name: 'Publică anunțul' }),
    );
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ group_id: 1 }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Anunțul așteaptă aprobarea BC.',
    );
  });

  it('is a form sheet: segmented Audiență and Prioritate, the Termen picker, a pinned footer and no boxed links', async () => {
    const user = userEvent.setup();
    render(<AnnouncementComposeSheet />);
    await user.click(screen.getByRole('button', { name: 'Anunț nou' }));
    const dialog = screen.getByRole('dialog', { name: 'Anunț nou' });
    expect(dialog).toHaveAttribute('data-slot', 'form-sheet');

    const audience = within(dialog).getByRole('radiogroup', {
      name: 'Audiență',
    });
    expect(audience).toHaveAttribute('data-slot', 'segmented-radio');
    expect(
      within(audience).getByRole('radio', { name: 'Doar grupul' }),
    ).toBeChecked();
    const priority = within(dialog).getByRole('radiogroup', {
      name: 'Prioritate',
    });
    expect(priority).toHaveAttribute('data-slot', 'segmented-radio');
    expect(
      within(priority)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Normală', 'Importantă', 'Critică']);
    expect(
      within(priority).getByRole('radio', { name: 'Normală' }),
    ).toBeChecked();

    expect(
      within(dialog).getByLabelText('Termen (opțional) — ora României'),
    ).toHaveAttribute('data-slot', 'date-picker');
    expect(
      within(dialog).getByRole('textbox', { name: 'Titlu' }),
    ).toHaveAttribute('data-slot', 'input');
    expect(
      within(dialog).getByRole('textbox', { name: 'Mesaj' }),
    ).toHaveAttribute('data-slot', 'textarea');
    expect(
      within(dialog).getByRole('checkbox', { name: 'Fixează anunțul' }),
    ).not.toBeChecked();

    const publish = within(dialog).getByRole('button', {
      name: 'Publică anunțul',
    });
    expect(publish.parentElement).toHaveAttribute('data-pinned', 'true');
    expect(publish.previousElementSibling).toHaveTextContent('Renunță');
    // The links are a section of the form, not a box inside it.
    const links = within(dialog).getByRole('group', {
      name: /Linkuri atașate/,
    });
    expect(links.parentElement?.tagName).toBe('FORM');
  });

  it('sends the Prioritate chosen in the segmented control', async () => {
    const user = userEvent.setup();
    render(<AnnouncementComposeSheet />);
    await user.click(screen.getByRole('button', { name: 'Anunț nou' }));
    const dialog = screen.getByRole('dialog', { name: 'Anunț nou' });
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Titlu' }),
      'Ședință',
    );
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Mesaj' }),
      'Vineri la 18:00',
    );
    await chooseOption(
      user,
      within(dialog).getByRole('combobox', { name: 'Grup de origine' }),
      'Echipa A',
    );
    await user.click(within(dialog).getByRole('radio', { name: 'Importantă' }));
    await user.click(
      within(dialog).getByRole('button', { name: 'Publică anunțul' }),
    );
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'important', audience: 'local' }),
    );
  });

  async function draftWithTermen(termen: string) {
    const user = userEvent.setup();
    render(<AnnouncementComposeSheet />);
    await user.click(screen.getByRole('button', { name: 'Anunț nou' }));
    const dialog = screen.getByRole('dialog', { name: 'Anunț nou' });
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Titlu' }),
      'Înscrieri',
    );
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Mesaj' }),
      'Formularul se închide vineri.',
    );
    await chooseOption(
      user,
      within(dialog).getByRole('combobox', { name: 'Grup de origine' }),
      'Echipa A',
    );
    await pickDate(
      user,
      within(dialog).getByLabelText('Termen (opțional) — ora României'),
      termen,
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Publică anunțul' }),
    );
    return dialog;
  }

  it('sends an optional Termen read in Romania (#909)', async () => {
    const termen = nearDate(1, '23:59');
    await draftWithTermen(termen);
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ deadline: bucharestWallTimeToIso(termen) }),
    );
    expect(mutateAsync.mock.calls[0]?.[0].deadline).toMatch(
      /T2[01]:59:00\.000Z$/,
    );
  });

  it('offers "Cine îl vede" by Role name up to the author\'s level and sends it (#909)', async () => {
    const user = userEvent.setup();
    render(<AnnouncementComposeSheet />);
    await user.click(screen.getByRole('button', { name: 'Anunț nou' }));
    const dialog = screen.getByRole('dialog', { name: 'Anunț nou' });
    const picker = within(dialog).getByRole('combobox', {
      name: 'Cine îl vede',
    });
    expect(picker).toHaveAttribute('data-value', '0');
    await user.click(picker);
    expect(
      (await screen.findAllByRole('option')).map(
        (option) => option.textContent,
      ),
    ).toEqual([
      'Recrut',
      'Voluntar',
      'Voluntar Activ',
      'Voluntar cu Drept de Vot',
    ]);
    await user.keyboard('{Escape}');
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Titlu' }),
      'Adunare',
    );
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Mesaj' }),
      'Doar pentru votanți.',
    );
    await chooseOption(
      user,
      within(dialog).getByRole('combobox', { name: 'Grup de origine' }),
      'Echipa A',
    );
    await chooseOption(user, picker, 'Voluntar cu Drept de Vot');
    await user.click(
      within(dialog).getByRole('button', { name: 'Publică anunțul' }),
    );
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ min_level: 3 }),
    );
  });

  it('refuses a Termen in the past under its field (#909, R8)', async () => {
    const dialog = await draftWithTermen(nearDate(-1, '10:00'));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(
      within(dialog).getByText('Termenul nu poate fi în trecut.'),
    ).toBeInTheDocument();
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
    await chooseOption(
      user,
      within(dialog).getByRole('combobox', { name: 'Grup de origine' }),
      'Echipa A',
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

  it('does not call the Origin missing while its list is open', async () => {
    const user = userEvent.setup();
    render(<AnnouncementComposeSheet />);
    await user.click(screen.getByRole('button', { name: 'Anunț nou' }));
    const dialog = screen.getByRole('dialog', { name: 'Anunț nou' });
    const origin = within(dialog).getByRole('combobox', {
      name: 'Grup de origine',
    });
    expect(origin).toHaveTextContent('Alege grupul');
    // Opening moves focus into the list: the member has not left the field.
    await user.click(origin);
    await screen.findByRole('option', { name: 'Echipa A' });
    expect(origin).not.toHaveAttribute('aria-invalid');
    // Closing it without a choice and moving on is leaving it empty.
    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('textbox', { name: 'Titlu' }));
    expect(origin).toHaveAttribute('aria-invalid', 'true');
  });

  it('rejects whitespace-only content and incomplete or non-web form links', async () => {
    const user = userEvent.setup();
    render(<AnnouncementComposeSheet />);
    await user.click(screen.getByRole('button', { name: 'Anunț nou' }));
    const dialog = screen.getByRole('dialog', { name: 'Anunț nou' });
    const title = within(dialog).getByRole('textbox', { name: 'Titlu' });
    const message = within(dialog).getByRole('textbox', { name: 'Mesaj' });
    const publish = within(dialog).getByRole('button', {
      name: 'Publică anunțul',
    });
    await user.type(title, '   ');
    await user.type(message, 'Text');
    await chooseOption(
      user,
      within(dialog).getByRole('combobox', { name: 'Grup de origine' }),
      'Echipa A',
    );
    await user.click(publish);
    expect(title).toHaveAccessibleDescription('Scrie titlul.');
    expect(title).toHaveFocus();
    expect(mutateAsync).not.toHaveBeenCalled();
    await user.clear(title);
    await user.type(title, 'Anunț');
    // R46: links are added one row at a time.
    await user.click(
      within(dialog).getByRole('button', { name: 'Adaugă link' }),
    );
    const formName = within(dialog).getByRole('textbox', {
      name: 'Etichetă link 1',
    });
    const formUrl = within(dialog).getByRole('textbox', {
      name: 'Adresă link 1',
    });
    await user.type(formName, 'Formular');
    await user.click(publish);
    expect(formUrl).toHaveAccessibleDescription(
      /Scrie adresa linkului sau lasă linkul gol\./,
    );
    await user.type(formUrl, 'ftp://example.com');
    await user.click(publish);
    expect(formUrl).toHaveAccessibleDescription(
      /Adresa trebuie să înceapă cu http:\/\/ sau https:\/\/\./,
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
