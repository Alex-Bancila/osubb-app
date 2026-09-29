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
  ['vot', { name: 'Membru cu Drept de Vot', level: 3 }],
  ['recrut', { name: 'Recrut', level: 0 }],
  ['moderator', { name: 'Moderator', level: 7 }],
  ['voluntar', { name: 'Voluntar', level: 1 }],
  ['bc', { name: 'BC', level: 6 }],
  ['activ', { name: 'Membru Activ', level: 2 }],
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
];

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
  return onInvited;
}

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
  });

  it('shows the ranks in the dialog, Recrut chosen, and names what a leadership rank opens', async () => {
    const user = userEvent.setup();
    show();
    const dialog = await openAndFill(user, { email: '', name: '' });
    const rank = within(dialog).getByLabelText('Rang');
    expect(rank).toHaveValue('recrut');
    expect(
      within(rank)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Recrut',
      'Voluntar',
      'Membru Activ',
      'Membru cu Drept de Vot',
      'BCE',
      'BC',
      'Moderator',
    ]);
    expect(within(dialog).queryByText(/deschide Administrare/)).toBeNull();
    await user.selectOptions(rank, 'moderator');
    expect(rank).toHaveAccessibleDescription(
      'Rangul Moderator deschide Administrare: poate invita membri și schimba rangul oricui.',
    );
  });
});

describe('the invitation', () => {
  it('sends the address, name and rank, with no Group unless one is chosen', async () => {
    const user = userEvent.setup();
    api.invoke.mockResolvedValue({
      data: { user_id: 'new-1', email: 'ana.pop@osubb.ro' },
      error: null,
    });
    const onInvited = show();
    const dialog = await openAndFill(user);
    await user.selectOptions(within(dialog).getByLabelText('Rang'), 'bc');
    await user.click(
      within(dialog).getByRole('button', { name: 'Trimite invitația' }),
    );
    await waitFor(() =>
      expect(onInvited).toHaveBeenCalledWith({
        userId: 'new-1',
        email: 'ana.pop@osubb.ro',
        name: 'Ana Pop',
      }),
    );
    expect(api.invoke).toHaveBeenCalledWith('invite-member', {
      body: { email: 'ana.pop@osubb.ro', full_name: 'Ana Pop', role: 'bc' },
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Invită membru' })).toBe(
        null,
      ),
    );
  });

  it('appoints the new Member to the chosen Group', async () => {
    const user = userEvent.setup();
    api.invoke.mockResolvedValue({
      data: { user_id: 'new-1', email: 'ana.pop@osubb.ro' },
      error: null,
    });
    const onInvited = show();
    const dialog = await openAndFill(user);
    await user.click(within(dialog).getByRole('combobox', { name: /Grup/ }));
    await user.click(await screen.findByRole('option', { name: /Educație/ }));
    await user.click(
      within(dialog).getByRole('button', { name: 'Trimite invitația' }),
    );
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
      await within(dialog).findByText(reasonCopy('email_invalid')!),
    ).toBeVisible();
    expect(
      within(dialog).getByText(reasonCopy('full_name_required')!),
    ).toBeVisible();
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
      const copy = reasonCopy(INVITE_REASON[code])!;
      expect(await within(dialog).findByText(copy)).toBeVisible();
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

  it('has no axe violations when open', async () => {
    const user = userEvent.setup();
    show();
    const dialog = await openAndFill(user, { email: '', name: '' });
    const results = await axe.run(dialog, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
