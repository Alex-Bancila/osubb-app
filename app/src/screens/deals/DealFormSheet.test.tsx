import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../../test/supabase-mock';

const caps = vi.hoisted(() => ({ manageDeals: true }));

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
    data: new Map([
      [1, { id: 1, name: 'OSUBB', is_organization: true }],
      [2, { id: 2, name: 'Educațional', is_organization: false }],
    ]),
  }),
}));

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

beforeEach(() => {
  resetSupabaseMock();
  caps.manageDeals = true;
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
    for (const label of [
      'Titlu',
      'Descriere',
      /Termen/,
      /Cod/,
      'Etichetă link',
    ])
      expect(within(sheet).getByLabelText(label)).toBeInTheDocument();
    for (const absent of [
      /Grup de origine/,
      /Audiență/,
      /Cine îl vede/,
      /Prioritate/,
      /Fixează/,
    ])
      expect(within(sheet).queryByText(absent)).toBeNull();
  });

  it('publishes a Deal of the Organization for everyone, with its link and code', async () => {
    const user = userEvent.setup();
    renderWith(<NewDealControl />);
    const sheet = await openCompose(user);
    await user.type(within(sheet).getByLabelText('Titlu'), '  Reducere 20%  ');
    await user.type(within(sheet).getByLabelText('Descriere'), 'Cărți.');
    await user.type(within(sheet).getByLabelText('Etichetă link'), 'Magazin');
    await user.type(
      within(sheet).getByLabelText('Adresă link'),
      'https://example.ro',
    );
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
      links: [{ label: 'Magazin', url: 'https://example.ro' }],
      code: 'OSUBB20',
    });
    expect(await screen.findByText('Deal-ul a fost publicat.')).toBeVisible();
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

  it('sends only what changed, and keeps the links it does not show', async () => {
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
