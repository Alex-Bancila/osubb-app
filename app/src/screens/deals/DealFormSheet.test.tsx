import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../../test/supabase-mock';

const caps = vi.hoisted(() => ({ manageDeals: true }));
const groupsState = vi.hoisted(() => ({ pending: false }));

vi.mock('../../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../../test/supabase-mock')
  >('../../test/supabase-mock');
  return { supabase: supabaseClientMock };
});
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}));
vi.mock('../../lib/capabilities', () => ({
  useCapability: (name: string) => ({
    data: (caps as Record<string, boolean>)[name] === true,
  }),
}));
vi.mock('../../queries/reference', () => ({
  useGroups: () => ({
    isPending: groupsState.pending,
    data: new Map([
      [1, { id: 1, name: 'OSUBB', is_organization: true }],
      [2, { id: 2, name: 'Educațional', is_organization: false }],
    ]),
  }),
}));

import {
  bucharestDayKey,
  bucharestWallTimeToIso,
} from '../../lib/calendar-time';
import { pickDate } from '../../test/date-picker';
import DealFormSheet, { NewDealControl } from './DealFormSheet';
import type { DealPresentation } from './deals-presentation';

function renderWith(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

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

beforeEach(() => {
  resetSupabaseMock();
  caps.manageDeals = true;
  groupsState.pending = false;
  supabaseMock.insert.mockResolvedValue({ error: null });
});

async function openCompose(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Deal nou' }));
  return screen.findByRole('dialog', { name: 'Deal nou' });
}

describe('Deal nou (R45)', () => {
  it('is offered to the OSUBB Deals team only', () => {
    caps.manageDeals = false;
    const { container } = renderWith(<NewDealControl />);
    expect(container).toBeEmptyDOMElement();
  });

  it('asks for the Deal fields alone — no Group, Audience, Level, Priority or pin', async () => {
    const user = userEvent.setup();
    renderWith(<NewDealControl />);
    const sheet = await openCompose(user);
    for (const label of ['Titlu', 'Descriere', /Termen/, /Cod/])
      expect(within(sheet).getByLabelText(label)).toBeInTheDocument();
    // Up to five Attached Links, one row at a time (R46).
    expect(
      within(sheet).getByRole('button', { name: 'Adaugă link' }),
    ).toBeVisible();
    for (const absent of [
      /Grup de origine/,
      /Audiență/,
      /Cine îl vede/,
      /Prioritate/,
      /Fixează/,
    ])
      expect(within(sheet).queryByText(absent)).toBeNull();
  });

  it('is a form sheet: the shared fields, hints behind their labels, a pinned footer and no intro', async () => {
    const user = userEvent.setup();
    renderWith(<NewDealControl />);
    const sheet = await openCompose(user);
    expect(sheet).toHaveAttribute('data-slot', 'form-sheet');
    expect(sheet).not.toHaveAttribute('aria-describedby');
    expect(within(sheet).getByLabelText('Titlu')).toHaveAttribute(
      'data-slot',
      'input',
    );
    expect(within(sheet).getByLabelText('Descriere')).toHaveAttribute(
      'data-slot',
      'textarea',
    );
    const termen = within(sheet).getByLabelText(
      'Termen (opțional) — ora României',
    );
    expect(termen).toHaveAttribute('data-slot', 'date-picker');
    expect(termen).toHaveAccessibleDescription(
      'După termen, deal-ul dispare pentru membri și rămâne la echipă.',
    );
    expect(
      within(sheet).getByLabelText('Cod (opțional)'),
    ).toHaveAccessibleDescription(
      'Membrii îl văd ascuns și îl deschid cu o atingere.',
    );
    // Each sentence waits behind its hint.
    expect(within(sheet).getByText(/dispare pentru membri/)).not.toBeVisible();
    for (const name of ['Despre termen', 'Despre cod'])
      expect(within(sheet).getByRole('button', { name })).toBeInTheDocument();

    const publish = within(sheet).getByRole('button', {
      name: 'Publică deal-ul',
    });
    expect(publish.parentElement).toHaveAttribute('data-pinned', 'true');
    expect(publish.previousElementSibling).toHaveTextContent('Renunță');
    expect(
      within(sheet).getByRole('group', { name: /Linkuri atașate/ })
        .parentElement?.tagName,
    ).toBe('FORM');
    // Who is notified is read before publishing.
    expect(
      within(sheet).getByText(/Fiecare primește o notificare/),
    ).toBeVisible();
  });

  it('sends a Termen chosen in the picker, read in Romania', async () => {
    const user = userEvent.setup();
    renderWith(<NewDealControl />);
    const sheet = await openCompose(user);
    await user.type(within(sheet).getByLabelText('Titlu'), 'Acces gratuit');
    await user.type(within(sheet).getByLabelText('Descriere'), 'Detalii.');
    const termen = within(sheet).getByLabelText(
      'Termen (opțional) — ora României',
    );
    // A deadline opens on the last minute of its day.
    await user.click(termen);
    expect(await screen.findByLabelText('Ora')).toHaveValue('23:59');
    await user.keyboard('{Escape}');
    const value = nearDate(1, '23:59');
    await pickDate(user, termen, value);
    await user.click(
      within(sheet).getByRole('button', { name: 'Publică deal-ul' }),
    );
    expect(supabaseMock.insert).toHaveBeenCalledWith(
      expect.objectContaining({ deadline: bucharestWallTimeToIso(value) }),
    );
  });

  it('publishes a Deal of the Organization for everyone, with its link and code', async () => {
    const user = userEvent.setup();
    renderWith(<NewDealControl />);
    const sheet = await openCompose(user);
    await user.type(within(sheet).getByLabelText('Titlu'), '  Reducere 20%  ');
    await user.type(within(sheet).getByLabelText('Descriere'), 'Cărți.');
    for (const [n, label, url] of [
      [1, 'Magazin', 'https://example.ro'],
      [2, 'Regulament', 'https://example.ro/r'],
    ] as const) {
      await user.click(
        within(sheet).getByRole('button', { name: 'Adaugă link' }),
      );
      await user.type(
        within(sheet).getByLabelText(`Etichetă link ${n}`),
        label,
      );
      await user.type(within(sheet).getByLabelText(`Adresă link ${n}`), url);
    }
    await user.type(within(sheet).getByLabelText(/Cod/), ' OSUBB20 ');
    await user.click(
      within(sheet).getByRole('button', { name: 'Publică deal-ul' }),
    );

    expect(supabaseMock.from).toHaveBeenCalledWith('announcements');
    expect(supabaseMock.insert).toHaveBeenCalledWith({
      kind: 'deal',
      group_id: 1,
      audience: 'org',
      min_level: 0,
      priority: 'normal',
      pinned: false,
      title: 'Reducere 20%',
      body: 'Cărți.',
      deadline: null,
      links: [
        { label: 'Magazin', url: 'https://example.ro' },
        { label: 'Regulament', url: 'https://example.ro/r' },
      ],
      code: 'OSUBB20',
    });
    expect(await screen.findByText('Deal-ul a fost publicat.')).toBeVisible();
  });

  it('waits for the Groups before it can publish, instead of calling OSUBB missing', async () => {
    const user = userEvent.setup();
    groupsState.pending = true;
    renderWith(<NewDealControl />);
    const sheet = await openCompose(user);
    expect(
      within(sheet).getByRole('button', { name: 'Publică deal-ul' }),
    ).toBeDisabled();
  });

  it('stores no link and no code when both are left empty', async () => {
    const user = userEvent.setup();
    renderWith(<NewDealControl />);
    const sheet = await openCompose(user);
    await user.type(within(sheet).getByLabelText('Titlu'), 'Acces gratuit');
    await user.type(within(sheet).getByLabelText('Descriere'), 'Detalii.');
    await user.click(
      within(sheet).getByRole('button', { name: 'Publică deal-ul' }),
    );
    expect(supabaseMock.insert).toHaveBeenCalledWith(
      expect.objectContaining({ links: [], code: null }),
    );
  });

  it('refuses a code over 80 characters under its field, before sending', async () => {
    const user = userEvent.setup();
    renderWith(<NewDealControl />);
    const sheet = await openCompose(user);
    await user.type(within(sheet).getByLabelText('Titlu'), 'Acces gratuit');
    await user.type(within(sheet).getByLabelText('Descriere'), 'Detalii.');
    await user.type(within(sheet).getByLabelText(/Cod/), 'X'.repeat(81));
    await user.click(
      within(sheet).getByRole('button', { name: 'Publică deal-ul' }),
    );
    expect(
      within(sheet).getByText('Codul are cel mult 80 de caractere.'),
    ).toBeVisible();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });

  it('puts a refusal from the team rule in words', async () => {
    const user = userEvent.setup();
    supabaseMock.insert.mockResolvedValue({
      error: { code: '42501', message: 'new row violates row-level security' },
    });
    renderWith(<NewDealControl />);
    const sheet = await openCompose(user);
    await user.type(within(sheet).getByLabelText('Titlu'), 'Acces gratuit');
    await user.type(within(sheet).getByLabelText('Descriere'), 'Detalii.');
    await user.click(
      within(sheet).getByRole('button', { name: 'Publică deal-ul' }),
    );
    expect(
      await within(sheet).findByText(
        'Doar echipa OSUBB Deals publică și modifică deal-uri.',
      ),
    ).toBeVisible();
  });
});

describe('Editează deal-ul', () => {
  const deal: DealPresentation = {
    id: 5,
    title: 'Reducere',
    body: 'Detalii',
    groupId: 1,
    authorMember: null,
    authorId: 'me',
    publishedAt: '2026-10-07T10:00:00Z',
    publishedLabel: '7 octombrie 2026, 13:00',
    deadline: null,
    links: [
      { label: 'Magazin', url: 'https://example.ro' },
      { label: 'Regulament', url: 'https://example.ro/r' },
    ],
    code: 'OSUBB20',
    isRead: true,
    isRevealed: false,
  };

  it('sends only what changed, every link kept as it was', async () => {
    const user = userEvent.setup();
    supabaseMock.select.mockResolvedValue({ data: [{ id: 5 }], error: null });
    const onDone = vi.fn();
    renderWith(
      <DealFormSheet deal={deal} open onOpenChange={vi.fn()} onDone={onDone} />,
    );
    const sheet = await screen.findByRole('dialog', {
      name: 'Editează deal-ul',
    });
    const code = within(sheet).getByLabelText(/Cod/);
    await user.clear(code);
    await user.type(code, 'OSUBB25');
    await user.click(
      within(sheet).getByRole('button', { name: 'Salvează modificările' }),
    );
    expect(supabaseMock.update).toHaveBeenCalledWith({ code: 'OSUBB25' });
    expect(supabaseMock.eq).toHaveBeenCalledWith('id', 5);
    expect(onDone).toHaveBeenCalled();
  });
});
