import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { knownReasons, reasonCopy } from '../../lib/command-reasons';
import type { AdminGroup } from '../../queries/groups-admin';

const api = vi.hoisted(() => ({
  invoke: vi.fn(),
  roles: vi.fn(),
  groups: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: api.invoke } },
}));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'bc-1' } } }),
}));
vi.mock('../../queries/reference', () => ({ useRoles: api.roles }));
vi.mock('../../queries/groups-admin', async (original) => ({
  ...(await original<object>()),
  useAdminGroups: api.groups,
}));
import { INVITE_FAILED, INVITE_REASON } from '../../queries/member-invitation';
import { InviteMemberDialog } from './InviteMemberDialog';
import { inviteGroupOptions, inviteRankOptions } from './invite-options';

const ROLES = new Map([
  ['vot', { name: 'Voluntar cu Drept de Vot', level: 3 }],
  ['recrut', { name: 'Recrut', level: 0 }],
  ['moderator', { name: 'Moderator', level: 9 }],
  ['voluntar', { name: 'Voluntar', level: 1 }],
  ['bc', { name: 'BC', level: 6 }],
  ['activ', { name: 'Voluntar Activ', level: 2 }],
  ['bce', { name: 'BCE', level: 5 }],
]);

function group(id: number, name: string, extra: Partial<AdminGroup> = {}) {
  return {
    id,
    name,
    short: null,
    color: null,
    category: 'department',
    path: [id],
    parent_id: null,
    min_level: 0,
    status: 'active',
    is_organization: false,
    is_private: false,
    manager_title: null,
    automatic_membership: false,
    accepts_applications: true,
    application_level: null,
    competes_in_cup: false,
    counts_toward_parent_cup: false,
    shared_work_visibility: false,
    application_form_label: null,
    application_form_url: null,
    memberCount: 0,
    ...extra,
  } as AdminGroup;
}

const GROUPS = [
  group(1, 'Educație'),
  group(2, 'Arhivă', { status: 'archived' }),
  group(3, 'Toți membrii', { automatic_membership: true }),
  group(4, 'OSUBB', { is_organization: true }),
  group(5, 'Consiliu', { min_level: 5 }),
  group(6, 'Moderare', { min_level: 9 }),
];

/** A reason's copy; a reason without copy fails the test that reads it. */
function copy(reason: string | undefined) {
  const text = reasonCopy(reason);
  if (text === undefined) throw new Error(`no copy for ${String(reason)}`);
  return text;
}

/** A refusal as supabase-js hands it over: the function's Response inside. */
function refusal(code: string, httpStatus = 400) {
  const context = new Response(JSON.stringify({ error: 'text', code }), {
    status: httpStatus,
    headers: { 'Content-Type': 'application/json' },
  });
  return {
    data: null,
    error: Object.assign(new Error('Edge Function returned a non-2xx'), {
      context,
    }),
  };
}

function show(onInvited = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <InviteMemberDialog onInvited={onInvited} />
    </QueryClientProvider>,
  );
  return Object.assign(onInvited, { client });
}

/** Ticks a Group in the "Grupuri" picker, opening it when it is closed. */
async function choose(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  name: RegExp,
) {
  if (!screen.queryByRole('listbox'))
    await user.click(within(dialog).getByRole('combobox', { name: 'Grupuri' }));
  await user.click(await screen.findByRole('option', { name }));
}

async function closePicker(user: ReturnType<typeof userEvent.setup>) {
  if (screen.queryByRole('listbox')) await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

function send(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  return user.click(
    within(dialog).getByRole('button', { name: 'Trimite invitația' }),
  );
}

const SENT = {
  data: { user_id: 'new-1', email: 'ana.pop@osubb.ro' },
  error: null,
};

async function openAndFill(
  user: ReturnType<typeof userEvent.setup>,
  { email = '  Ana.Pop@OSUBB.ro ', name = '  Ana Pop ' } = {},
) {
  await user.click(screen.getByRole('button', { name: 'Invită membru' }));
  const dialog = await screen.findByRole('dialog', { name: 'Invită membru' });
  if (email)
    await user.type(within(dialog).getByLabelText('Adresa de email'), email);
  if (name)
    await user.type(within(dialog).getByLabelText('Numele complet'), name);
  return dialog;
}

beforeEach(() => {
  api.invoke.mockReset();
  api.roles.mockReturnValue({ data: ROLES });
  api.groups.mockReturnValue({ data: GROUPS });
});

describe('rank and Group options', () => {
  it('offers every live rank, BC and Moderator included (R31), in rank order', () => {
    expect(inviteRankOptions(ROLES).map(([id]) => id)).toEqual([
      'recrut',
      'voluntar',
      'activ',
      'vot',
      'bce',
      'bc',
      'moderator',
    ]);
  });

  it('never offers the retired level-4 rank, even from a stale row', () => {
    const stale = new Map(ROLES).set('responsabil', {
      name: 'Responsabil',
      level: 4,
    });
    expect(inviteRankOptions(stale).map(([id]) => id)).not.toContain(
      'responsabil',
    );
  });

  it('lists only active, appointable Groups open to the chosen rank', () => {
    expect(inviteGroupOptions(GROUPS, 0).map((row) => row.name)).toEqual([
      'Educație',
    ]);
    expect(inviteGroupOptions(GROUPS, 6).map((row) => row.name)).toEqual([
      'Consiliu',
      'Educație',
    ]);
    expect(inviteGroupOptions(GROUPS, 9).map((row) => row.name)).toEqual([
      'Consiliu',
      'Educație',
      'Moderare',
    ]);
  });

  it('shows the ranks in the dialog, Recrut chosen, and names what a leadership rank opens', async () => {
    const user = userEvent.setup();
    show();
    const dialog = await openAndFill(user, { email: '', name: '' });
    const rank = within(dialog).getByLabelText('Rol');
    expect(rank).toHaveValue('recrut');
    expect(
      within(rank)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Recrut',
      'Voluntar',
      'Voluntar Activ',
      'Voluntar cu Drept de Vot',
      'BCE',
      'BC',
      'Moderator',
    ]);
    expect(within(dialog).queryByText(/deschide Administrare/)).toBeNull();
    expect(within(dialog).getByLabelText('Adresa de email')).toBeRequired();
    expect(within(dialog).getByLabelText('Numele complet')).toBeRequired();
    // #949: Rol and Grupuri are the optional part, under their own legend.
    const optional = within(dialog).getByRole('group', { name: 'Opțional' });
    expect(within(optional).getByLabelText('Rol')).toBe(rank);
    expect(
      within(optional).getByRole('combobox', { name: 'Grupuri' }),
    ).toHaveAccessibleDescription(
      'Fără grup: membrul intră doar în OSUBB și își alege departamentul mai târziu.',
    );
    expect(within(optional).queryByLabelText('Adresa de email')).toBeNull();
    await user.selectOptions(rank, 'moderator');
    expect(rank).toHaveAccessibleDescription(
      'Rolul Moderator deschide Administrare: poate invita membri și schimba rolul oricui.',
    );
  });
});

describe('the invitation', () => {
  it('with only the address and name, invites a Recrut in no Group (OSUBB only)', async () => {
    const user = userEvent.setup();
    api.invoke.mockResolvedValue(SENT);
    const onInvited = show();
    const dialog = await openAndFill(user);
    await send(user, dialog);
    await waitFor(() =>
      expect(onInvited).toHaveBeenCalledWith({
        userId: 'new-1',
        email: 'ana.pop@osubb.ro',
        name: 'Ana Pop',
      }),
    );
    expect(api.invoke).toHaveBeenCalledWith('invite-member', {
      body: {
        email: 'ana.pop@osubb.ro',
        full_name: 'Ana Pop',
        role: 'recrut',
        group_ids: [],
      },
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Invită membru' })).toBe(
        null,
      ),
    );
  });

  it('sends the chosen rank', async () => {
    const user = userEvent.setup();
    api.invoke.mockResolvedValue(SENT);
    const onInvited = show();
    const dialog = await openAndFill(user);
    await user.selectOptions(within(dialog).getByLabelText('Rol'), 'bc');
    await send(user, dialog);
    await waitFor(() => expect(onInvited).toHaveBeenCalled());
    expect(api.invoke).toHaveBeenCalledWith('invite-member', {
      body: {
        email: 'ana.pop@osubb.ro',
        full_name: 'Ana Pop',
        role: 'bc',
        group_ids: [],
      },
    });
  });

  it('places the new Member in several Groups, each removable before sending', async () => {
    const user = userEvent.setup();
    api.invoke.mockResolvedValue(SENT);
    const onInvited = show();
    const dialog = await openAndFill(user);
    await user.selectOptions(within(dialog).getByLabelText('Rol'), 'moderator');
    await choose(user, dialog, /Educație/);
    await choose(user, dialog, /Consiliu/);
    await choose(user, dialog, /Moderare/);
    await closePicker(user);
    const picker = within(dialog).getByRole('combobox', { name: 'Grupuri' });
    expect(picker).toHaveTextContent('3 grupuri alese');
    // The OSUBB hint names the default; with Groups chosen it is gone.
    expect(within(dialog).queryByText(/Fără grup/)).toBeNull();
    const chips = within(dialog).getByRole('list', { name: 'Grupuri alese' });
    expect(
      within(chips)
        .getAllByRole('button')
        .map((chip) => chip.getAttribute('aria-label')),
    ).toEqual([
      'Scoate grupul Educație',
      'Scoate grupul Consiliu',
      'Scoate grupul Moderare',
    ]);
    await user.click(
      within(chips).getByRole('button', { name: 'Scoate grupul Consiliu' }),
    );
    // Focus moves to the chip now in its place.
    expect(
      within(chips).getByRole('button', { name: 'Scoate grupul Moderare' }),
    ).toHaveFocus();
    await send(user, dialog);
    await waitFor(() => expect(onInvited).toHaveBeenCalled());
    expect(api.invoke).toHaveBeenCalledWith('invite-member', {
      body: {
        email: 'ana.pop@osubb.ro',
        full_name: 'Ana Pop',
        role: 'moderator',
        group_ids: [1, 6],
      },
    });
  });

  it('offers only the Groups the chosen rank may join, and drops the rest from the choice', async () => {
    const user = userEvent.setup();
    api.invoke.mockResolvedValue(SENT);
    const onInvited = show();
    const dialog = await openAndFill(user);
    const rank = within(dialog).getByLabelText('Rol');
    await user.click(within(dialog).getByRole('combobox', { name: 'Grupuri' }));
    expect(
      within(await screen.findByRole('listbox'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Educație']);
    await closePicker(user);

    await user.selectOptions(rank, 'bce');
    await choose(user, dialog, /Consiliu/);
    await choose(user, dialog, /Educație/);
    await closePicker(user);
    await user.selectOptions(rank, 'recrut');
    // Consiliu wants level 5: it leaves the choice with the rank.
    expect(
      within(dialog).queryByRole('button', { name: 'Scoate grupul Consiliu' }),
    ).toBeNull();
    await send(user, dialog);
    await waitFor(() => expect(onInvited).toHaveBeenCalled());
    expect(api.invoke).toHaveBeenCalledWith('invite-member', {
      body: {
        email: 'ana.pop@osubb.ro',
        full_name: 'Ana Pop',
        role: 'recrut',
        group_ids: [1],
      },
    });
  });

  it('checks the address and the name before calling the function', async () => {
    const user = userEvent.setup();
    show();
    const dialog = await openAndFill(user, { email: 'nu-e-adresa', name: '' });
    await user.click(
      within(dialog).getByRole('button', { name: 'Trimite invitația' }),
    );
    expect(
      await within(dialog).findByText(copy('email_invalid')),
    ).toBeVisible();
    expect(within(dialog).getByText(copy('full_name_required'))).toBeVisible();
    expect(api.invoke).not.toHaveBeenCalled();
  });

  it('has copy for every refusal the function answers', () => {
    for (const reason of Object.values(INVITE_REASON))
      expect(knownReasons().has(reason), reason).toBe(true);
  });

  it.each(Object.keys(INVITE_REASON))(
    'shows the refusal %s in Romanian and keeps the dialog open',
    async (code) => {
      const user = userEvent.setup();
      api.invoke.mockResolvedValue(refusal(code));
      const onInvited = show();
      const dialog = await openAndFill(user);
      await user.click(
        within(dialog).getByRole('button', { name: 'Trimite invitația' }),
      );
      const message = copy(INVITE_REASON[code]);
      expect(await within(dialog).findByText(message)).toBeVisible();
      expect(within(dialog).queryByText(code)).toBeNull();
      expect(onInvited).not.toHaveBeenCalled();
    },
  );

  it('puts a taken address under the address field', async () => {
    const user = userEvent.setup();
    api.invoke.mockResolvedValue(refusal('already_exists', 409));
    show();
    const dialog = await openAndFill(user);
    await user.click(
      within(dialog).getByRole('button', { name: 'Trimite invitația' }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByLabelText('Adresa de email'),
      ).toHaveAccessibleDescription(reasonCopy('invite_email_taken')),
    );
  });

  it('puts a Group refusal under Grupuri and clears it once the choice changes', async () => {
    const user = userEvent.setup();
    api.invoke.mockResolvedValue(refusal('provision_failed'));
    show();
    const dialog = await openAndFill(user);
    await choose(user, dialog, /Educație/);
    await closePicker(user);
    await send(user, dialog);
    const message = copy('invite_group_refused');
    expect(await within(dialog).findByText(message)).toBeVisible();
    expect(
      within(dialog).getByRole('combobox', { name: 'Grupuri' }),
    ).toHaveAccessibleDescription(message);
    await user.click(
      within(dialog).getByRole('button', { name: 'Scoate grupul Educație' }),
    );
    expect(within(dialog).queryByText(message)).toBeNull();
  });

  it('reloads the Groups after a refusal and keeps saying why a Group left the list', async () => {
    const user = userEvent.setup();
    api.invoke.mockResolvedValue(refusal('group_archived'));
    const { client } = show();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const dialog = await openAndFill(user);
    await choose(user, dialog, /Educație/);
    await closePicker(user);
    // Educație was archived after the list loaded; the reload says so.
    api.groups.mockReturnValue({
      data: GROUPS.map((row) =>
        row.id === 1 ? { ...row, status: 'archived' } : row,
      ),
    });
    await send(user, dialog);
    const message = copy('invite_group_archived');
    expect(await within(dialog).findByText(message)).toBeVisible();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['groups'] });
    expect(
      within(dialog).queryByRole('button', { name: 'Scoate grupul Educație' }),
    ).toBeNull();
    expect(within(dialog).getByText(message)).toBeVisible();
    expect(api.invoke).toHaveBeenLastCalledWith('invite-member', {
      body: {
        email: 'ana.pop@osubb.ro',
        full_name: 'Ana Pop',
        role: 'recrut',
        group_ids: [1],
      },
    });
  });

  it('falls back to its own message when the gateway answers without a body', async () => {
    const user = userEvent.setup();
    api.invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('Failed to send a request'), {
        context: new Response('Bad Gateway', { status: 502 }),
      }),
    });
    show();
    const dialog = await openAndFill(user);
    await user.click(
      within(dialog).getByRole('button', { name: 'Trimite invitația' }),
    );
    expect(await within(dialog).findByText(INVITE_FAILED)).toBeVisible();
  });

  it('has no axe violations when open, with Groups chosen', async () => {
    const user = userEvent.setup();
    show();
    const dialog = await openAndFill(user, { email: '', name: '' });
    await choose(user, dialog, /Educație/);
    await closePicker(user);
    const results = await axe.run(dialog, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
