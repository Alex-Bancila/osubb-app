import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AdminGroup } from '../../queries/groups-admin';

/*
 * Administrare → Setări (#825, #923): the organization settings, grouped by
 * purpose, each a row with its effect, the value in force ("Nesetat" when
 * empty) and one edit pattern. A small fake of the database behind the tab:
 * `org_settings` through `from()` and `set_org_setting` through `rpc()`,
 * which records its payload and can refuse with a server reason.
 */
const db = vi.hoisted(() => ({
  settings: new Map<string, string | null>(),
  refuse: new Map<string, string>(),
  rpc: vi.fn(),
  groups: vi.fn(),
}));

vi.mock('../../lib/supabase', () => {
  const rows = () => [...db.settings].map(([key, value]) => ({ key, value }));
  const from = (table: string) => {
    if (table !== 'org_settings') throw new Error(`unexpected table ${table}`);
    const builder = {
      select: () => builder,
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: rows(), error: null }),
    };
    return builder;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    db.rpc(name, args);
    const reason = db.refuse.get(name);
    if (reason)
      return { data: null, error: { code: 'PT400', message: reason } };
    if (name !== 'set_org_setting') throw new Error(`unexpected rpc ${name}`);
    const value = String(args.p_value).trim();
    db.settings.set(String(args.p_key), value === '' ? null : value);
    return { data: null, error: null };
  };
  return { supabase: { from, rpc } };
});
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    session: { user: { id: 'bc' } },
    claims: { member_level: 6 },
  }),
}));
vi.mock('../../queries/groups-admin', async (original) => ({
  ...(await original<object>()),
  useAdminGroups: db.groups,
}));
import AdminSettingsTab from './AdminSettingsTab';

vi.setConfig({ testTimeout: 15_000 });

function group(id: number, name: string, extra: Partial<AdminGroup> = {}) {
  return {
    id,
    name,
    status: 'active',
    is_private: false,
    ...extra,
  } as AdminGroup;
}

beforeEach(() => {
  db.settings = new Map<string, string | null>([
    ['adherence_form_url', null],
    ['adunarea_generala_group_id', null],
    ['board_group_id', null],
    ['vote_retention_percent', '25'],
    ['email_daily_quota', '90'],
  ]);
  db.refuse = new Map();
  db.rpc.mockReset();
  const team = {
    category: 'team',
    parent_id: null,
    automatic_membership: true,
    is_organization: false,
    min_level: 3,
  };
  db.groups.mockReturnValue({
    data: [
      group(1, 'OSUBB', {
        category: 'organization',
        is_organization: true,
        automatic_membership: true,
        parent_id: null,
      }),
      group(5, 'Adunarea Generală', team),
      group(8, 'Educațional', {
        category: 'department',
        parent_id: null,
        automatic_membership: false,
      }),
      group(9, 'Echipa IT', { ...team, parent_id: 8 }),
      group(10, 'Echipa Logistică', { ...team, automatic_membership: false }),
      group(11, 'Voluntari activi', { ...team, min_level: 2 }),
      group(6, 'Consiliu privat', { is_private: true }),
      group(7, 'Gala 2025', { status: 'archived' }),
    ],
    isPending: false,
    isError: false,
  });
});

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/administrare/setari']}>
        <AdminSettingsTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rpcCalls = (name: string) =>
  db.rpc.mock.calls.filter(([called]) => called === name).map(([, a]) => a);

/** The setting's row, named by its label. */
const row = (label: string) => screen.findByRole('listitem', { name: label });
/** The value the row shows as in force. */
const valueOf = (item: HTMLElement) =>
  item.querySelector('[data-slot="setting-value"]') as HTMLElement;

it('groups the settings by purpose, each with its effect, value and one Editează (#923)', async () => {
  const { container } = show();
  const promotions = await screen.findByRole('region', {
    name: 'Promovări și evaluări',
  });
  const profile = screen.getByRole('region', { name: 'Profilul membrilor' });
  // Sections by purpose, and no eyebrow that could contradict the tab.
  expect(container.querySelector('[data-slot="section-eyebrow"]')).toBeNull();
  expect(
    within(promotions)
      .getAllByRole('listitem')
      .map((item) => item.getAttribute('data-setting')),
  ).toEqual(['adherence_form_url', 'adunarea_generala_group_id']);
  expect(
    within(profile)
      .getAllByRole('listitem')
      .map((item) => item.getAttribute('data-setting')),
  ).toEqual(['board_group_id']);
  const emails = screen.getByRole('region', { name: 'Emailuri' });
  expect(
    within(emails)
      .getAllByRole('listitem')
      .map((item) => item.getAttribute('data-setting')),
  ).toEqual(['email_daily_quota']);
  // The thresholds and shares live in Evaluări de rol (R28, R30).
  expect(
    within(promotions).getByRole('link', { name: /Praguri și procente/ }),
  ).toHaveAttribute('href', '/administrare/evaluari');

  // Every setting: one sentence of effect, "Nesetat" with its consequence,
  // and the same Editează button; no editor open, no permanent hint.
  const expected = [
    [
      'Formular de adeziune',
      'Membrii promovați Voluntar Activ primesc acest link în notificare, ca să completeze adeziunea.',
      'Membrii promovați nu primesc niciun link: află doar că formularul vine de la BC.',
    ],
    [
      'Grupul Adunării Generale',
      'Managerii și responsabilii acestui grup și ai grupurilor de deasupra lui văd clasamentul complet al evaluărilor de rol.',
      'Doar BC și Moderatorul văd clasamentul complet.',
    ],
    [
      'Grupul Biroului de Conducere',
      'Titlul fiecărui responsabil din acest grup privat apare pe Profilul lui, la Funcția în OSUBB.',
      'Profilul membrilor BC și BCE arată rolul, nu un titlu.',
    ],
  ] as const;
  for (const [label, effect, unset] of expected) {
    const item = await row(label);
    expect(within(item).getByText(effect)).toBeVisible();
    expect(within(valueOf(item)).getByText('Nesetat')).toBeVisible();
    expect(within(valueOf(item)).getByText(unset)).toBeVisible();
    expect(
      within(item).getByRole('button', { name: `Editează ${label}` }),
    ).toBeEnabled();
  }
  // Ruling R28: no Periods; Retention Signals are not this setting's (F-14).
  expect(container).not.toHaveTextContent(/perioad|semnal|http:\/\//i);
  expect(container.querySelectorAll('form')).toHaveLength(0);
  expect((await axe.run(container)).violations).toEqual([]);
});

it('shows the adherence form in force as a link, only when it is http(s)', async () => {
  db.settings.set('adherence_form_url', 'https://forms.example.org/adeziune');
  const view = show();
  const item = await row('Formular de adeziune');
  const link = within(valueOf(item)).getByRole('link', {
    name: /forms\.example\.org\/adeziune/,
  });
  expect(link).toHaveAttribute('href', 'https://forms.example.org/adeziune');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(within(item).queryByText('Nesetat')).toBeNull();
  view.unmount();

  // A value written outside the server's guard is shown, never linked.
  db.settings.set('adherence_form_url', 'javascript:alert(1)');
  show();
  const unsafe = await row('Formular de adeziune');
  expect(within(unsafe).getByText('javascript:alert(1)')).toBeVisible();
  expect(within(unsafe).queryByRole('link')).toBeNull();
});

it('edits the adherence form: refuses, saves, cancels and clears', async () => {
  const user = userEvent.setup();
  show();
  const item = await row('Formular de adeziune');
  const edit = within(item).getByRole('button', {
    name: 'Editează Formular de adeziune',
  });
  await user.click(edit);
  const field = within(item).getByRole('textbox', {
    name: 'Formular de adeziune',
  });
  expect(field).toHaveFocus();
  const save = within(item).getByRole('button', { name: 'Salvează' });
  // Unchanged: nothing to save, and no hint about clearing an empty value.
  expect(save).toBeDisabled();
  expect(item).not.toHaveTextContent('Lasă câmpul gol');

  // ftp:// is refused in the browser, under the field, only now.
  await user.type(field, 'ftp://example.org/form');
  await user.click(save);
  expect(
    within(item).getByText(
      'Adresa trebuie să înceapă cu http:// sau https://.',
    ),
  ).toBeVisible();
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(rpcCalls('set_org_setting')).toEqual([]);

  // … and the server's own refusal lands in the same place.
  db.refuse.set('set_org_setting', 'invalid_org_setting_value');
  await user.clear(field);
  await user.type(field, 'https://forms.example.org/adeziune');
  await user.click(save);
  expect(
    await within(item).findByText(/Valoarea nu este acceptată/),
  ).toBeVisible();

  db.refuse.clear();
  await user.click(within(item).getByRole('button', { name: 'Salvează' }));
  await waitFor(() =>
    expect(rpcCalls('set_org_setting').at(-1)).toEqual({
      p_key: 'adherence_form_url',
      p_value: 'https://forms.example.org/adeziune',
    }),
  );
  expect(await within(item).findByRole('status')).toHaveTextContent(
    'Setare salvată.',
  );
  expect(
    await within(valueOf(item)).findByRole('link', {
      name: /forms\.example\.org\/adeziune/,
    }),
  ).toBeVisible();
  expect(within(item).queryByRole('textbox')).toBeNull();
  expect(
    within(item).getByRole('button', { name: 'Editează Formular de adeziune' }),
  ).toHaveFocus();

  // Renunță drops the draft: the value in force stays, nothing is sent.
  const sent = rpcCalls('set_org_setting').length;
  await user.click(
    within(item).getByRole('button', { name: 'Editează Formular de adeziune' }),
  );
  await user.clear(within(item).getByRole('textbox'));
  await user.type(within(item).getByRole('textbox'), 'https://altceva.ro');
  await user.click(within(item).getByRole('button', { name: 'Renunță' }));
  expect(within(item).queryByRole('textbox')).toBeNull();
  expect(rpcCalls('set_org_setting')).toHaveLength(sent);
  expect(
    within(valueOf(item)).getByRole('link', {
      name: /forms\.example\.org\/adeziune/,
    }),
  ).toBeVisible();
  expect(within(item).getByRole('status')).toBeEmptyDOMElement();
  // … and reopening starts from the value in force.
  await user.click(
    within(item).getByRole('button', { name: 'Editează Formular de adeziune' }),
  );
  expect(within(item).getByRole('textbox')).toHaveValue(
    'https://forms.example.org/adeziune',
  );

  // Emptying the field clears the setting; the hint says so, now relevant.
  expect(item).toHaveTextContent(
    'Lasă câmpul gol ca să nu mai trimiți niciun link.',
  );
  await user.clear(within(item).getByRole('textbox'));
  await user.click(within(item).getByRole('button', { name: 'Salvează' }));
  await waitFor(() =>
    expect(rpcCalls('set_org_setting').at(-1)).toEqual({
      p_key: 'adherence_form_url',
      p_value: '',
    }),
  );
  expect(await within(valueOf(item)).findByText('Nesetat')).toBeVisible();
  expect(within(item).queryByRole('link')).toBeNull();
});

it('edits the Adunarea Generală among top-level Teams with automatic membership (B59)', async () => {
  const user = userEvent.setup();
  show();
  const item = await row('Grupul Adunării Generale');
  await user.click(
    within(item).getByRole('button', {
      name: 'Editează Grupul Adunării Generale',
    }),
  );
  const select = within(item).getByRole('combobox', {
    name: 'Grupul Adunării Generale',
  });
  expect(select).toHaveFocus();
  expect(select).toHaveAttribute('data-slot', 'native-select');
  // Not OSUBB, a Department, a child Team, a Team with a roster or one at
  // another Minimum Level than 3.
  expect(
    within(select)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['Alege un grup', 'Adunarea Generală']);
  const save = within(item).getByRole('button', { name: 'Salvează' });
  expect(save).toBeDisabled();

  // Renunță after a choice sends nothing and keeps "Nesetat".
  await user.selectOptions(select, '5');
  expect(save).toBeEnabled();
  await user.click(within(item).getByRole('button', { name: 'Renunță' }));
  expect(rpcCalls('set_org_setting')).toEqual([]);
  expect(within(valueOf(item)).getByText('Nesetat')).toBeVisible();

  // A server refusal is shown in the editor, which stays open.
  db.refuse.set('set_org_setting', 'invalid_org_setting_value');
  await user.click(
    within(item).getByRole('button', {
      name: 'Editează Grupul Adunării Generale',
    }),
  );
  await user.selectOptions(within(item).getByRole('combobox'), '5');
  await user.click(within(item).getByRole('button', { name: 'Salvează' }));
  expect(await within(item).findByRole('alert')).toHaveTextContent(
    /Valoarea nu este acceptată/,
  );
  expect(within(item).getByRole('combobox')).toBeVisible();

  db.refuse.clear();
  await user.click(within(item).getByRole('button', { name: 'Salvează' }));
  await waitFor(() =>
    expect(rpcCalls('set_org_setting').at(-1)).toEqual({
      p_key: 'adunarea_generala_group_id',
      p_value: '5',
    }),
  );
  expect(await within(item).findByRole('status')).toHaveTextContent(
    'Setare salvată.',
  );
  expect(within(valueOf(item)).getByText('Adunarea Generală')).toBeVisible();
  expect(within(item).queryByText('Nesetat')).toBeNull();
});

it('points the board setting at an active Private Group and clears it (#824)', async () => {
  const user = userEvent.setup();
  db.settings.set('board_group_id', '6');
  show();
  const item = await row('Grupul Biroului de Conducere');
  expect(within(valueOf(item)).getByText('Consiliu privat')).toBeVisible();
  await user.click(
    within(item).getByRole('button', {
      name: 'Editează Grupul Biroului de Conducere',
    }),
  );
  const select = within(item).getByRole('combobox', {
    name: 'Grupul Biroului de Conducere',
  });
  expect(select).toHaveValue('6');
  expect(
    within(select)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['Niciun grup', 'Consiliu privat']);

  // A blank choice clears it on the server.
  await user.selectOptions(select, '');
  await user.click(within(item).getByRole('button', { name: 'Salvează' }));
  await waitFor(() =>
    expect(rpcCalls('set_org_setting').at(-1)).toEqual({
      p_key: 'board_group_id',
      p_value: '',
    }),
  );
  expect(await within(item).findByRole('status')).toHaveTextContent(
    'Setare salvată.',
  );
  expect(await within(valueOf(item)).findByText('Nesetat')).toBeVisible();
  expect(
    within(item).getByText(
      'Profilul membrilor BC și BCE arată rolul, nu un titlu.',
    ),
  ).toBeVisible();
});

it('lets the editor be left when the Groups cannot be loaded', async () => {
  const user = userEvent.setup();
  const refetch = vi.fn();
  db.settings.set('adunarea_generala_group_id', '5');
  db.groups.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: true,
    refetch,
  });
  show();
  const item = await row('Grupul Adunării Generale');
  expect(
    within(valueOf(item)).getByText('Numele grupului nu s-a putut încărca.'),
  ).toBeVisible();
  await user.click(
    within(item).getByRole('button', {
      name: 'Editează Grupul Adunării Generale',
    }),
  );
  expect(within(item).getByRole('alert')).toHaveTextContent(
    'Nu am putut încărca grupurile.',
  );
  await user.click(
    within(item).getByRole('button', { name: 'Încearcă din nou' }),
  );
  expect(refetch).toHaveBeenCalled();
  await user.click(within(item).getByRole('button', { name: 'Renunță' }));
  expect(within(item).queryByRole('alert')).toBeNull();
  expect(
    within(item).getByRole('button', {
      name: 'Editează Grupul Adunării Generale',
    }),
  ).toHaveFocus();
  expect(rpcCalls('set_org_setting')).toEqual([]);
});

it('shows and edits the daily email quota, refusing anything but 0-99999 (#932)', async () => {
  const user = userEvent.setup();
  show();
  const item = await row('Limita zilnică de emailuri');
  // What it limits, read from claim_email_digests (#775).
  expect(
    within(item).getByText(
      'Câte rezumate cu notificările necitite pleacă pe email într-o zi, la toți membrii la un loc; cele peste limită așteaptă ziua următoare.',
    ),
  ).toBeVisible();
  expect(valueOf(item)).toHaveTextContent('90 pe zi');

  await user.click(
    within(item).getByRole('button', {
      name: 'Editează Limita zilnică de emailuri',
    }),
  );
  const field = within(item).getByRole('textbox', {
    name: 'Limita zilnică de emailuri',
  });
  expect(field).toHaveFocus();
  expect(field).toHaveValue('90');
  expect(field).toHaveAttribute('inputmode', 'numeric');
  expect(field).toHaveAccessibleDescription(/0 oprește rezumatele/);
  const save = within(item).getByRole('button', { name: 'Salvează' });
  expect(save).toBeDisabled();

  // Blank, negative, decimal and too-large values never reach the server.
  for (const bad of [' ', '-1', '2.5', '100000']) {
    await user.clear(field);
    await user.type(field, bad);
    await user.click(save);
    expect(
      within(item).getByText('Scrie un număr întreg de la 0 la 99999.'),
    ).toBeVisible();
  }
  expect(rpcCalls('set_org_setting')).toEqual([]);

  await user.clear(field);
  await user.type(field, ' 0 ');
  await user.click(save);
  await waitFor(() =>
    expect(rpcCalls('set_org_setting').at(-1)).toEqual({
      p_key: 'email_daily_quota',
      p_value: '0',
    }),
  );
  expect(await within(item).findByRole('status')).toHaveTextContent(
    'Setare salvată.',
  );
  // 0 pauses the digest, and the row says so.
  expect(
    await within(valueOf(item)).findByText('Oprit: niciun rezumat pe email'),
  ).toBeVisible();
  expect(
    within(item).getByRole('button', {
      name: 'Editează Limita zilnică de emailuri',
    }),
  ).toHaveFocus();
});
