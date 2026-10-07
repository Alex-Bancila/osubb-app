import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../../test/supabase-mock';

vi.mock('../../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../../test/supabase-mock')
  >('../../test/supabase-mock');
  return { supabase: supabaseClientMock };
});
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);

import DealCard from './DealCard';
import type { DealPresentation } from './deals-presentation';

const DEAL: DealPresentation = {
  id: 7,
  title: 'Cafea la jumătate de preț',
  body: 'La cafeneaua din campus.',
  groupId: 1,
  authorMember: { memberId: 'author', fullName: 'Ioana Popescu' },
  authorId: 'author',
  publishedAt: '2026-10-07T10:00:00Z',
  publishedLabel: '7 octombrie 2026, 13:00',
  deadline: null,
  links: [],
  code: 'CAFE50',
  isRead: true,
  isRevealed: false,
};

function renderCard(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function footerOf(card: HTMLElement): HTMLElement {
  const footer = card.querySelector<HTMLElement>('[data-slot="card-footer"]');
  if (!footer) throw new Error('The card has no footer.');
  return footer;
}
const stubOf = (card: HTMLElement) =>
  card.querySelector<HTMLElement>('[data-slot="deal-code"]');
function stubIn(card: HTMLElement): HTMLElement {
  const stub = stubOf(card);
  if (!stub) throw new Error('The card has no Deal Code stub.');
  return stub;
}

beforeEach(() => {
  resetSupabaseMock();
  supabaseMock.rpc.mockResolvedValue({ data: 'CAFE50', error: null });
});

describe('DealCard (R45)', () => {
  it('tears the Deal Code off as the last strip of the card, under the footer', () => {
    renderCard(<DealCard deal={DEAL} onOpen={() => {}} />);
    const card = screen.getByRole('article', { name: DEAL.title });
    const stub = stubIn(card);
    expect(stub).toHaveClass('deal-stub');
    expect(card.lastElementChild).toBe(stub);
    expect(stub.previousElementSibling).toBe(footerOf(card));
    // The footer meets the perforation square; the stub rounds the corners.
    expect(footerOf(card)).toHaveClass('rounded-b-none');
    expect(stub).toHaveClass('rounded-b-md');
  });

  it('gives a Deal without a code no stub, and a footer that closes the card', () => {
    renderCard(<DealCard deal={{ ...DEAL, code: null }} onOpen={() => {}} />);
    const card = screen.getByRole('article', { name: DEAL.title });
    expect(stubOf(card)).toBeNull();
    expect(card.lastElementChild).toBe(footerOf(card));
    expect(footerOf(card)).not.toHaveClass('rounded-b-none');
  });

  it('puts the author, the team meta and the actions in one footer row with Citește', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderCard(
      <DealCard
        deal={DEAL}
        onOpen={onOpen}
        footerMeta={<span>Codul a fost deschis de 2 membri</span>}
        footerActions={<button type="button">Editează</button>}
      />,
    );
    const footer = footerOf(screen.getByRole('article', { name: DEAL.title }));
    expect(within(footer).getByText('Ioana Popescu')).toBeVisible();
    expect(
      within(footer).getByText('Codul a fost deschis de 2 membri'),
    ).toBeVisible();
    expect(
      within(footer).getByRole('button', { name: 'Editează' }),
    ).toBeVisible();
    await user.click(
      within(footer).getByRole('button', {
        name: `Citește deal-ul ${DEAL.title}`,
      }),
    );
    expect(onOpen).toHaveBeenCalledWith(DEAL);
  });

  it('marks an expired Deal once, by its Termen row, and mutes its stub without disabling it', async () => {
    const user = userEvent.setup();
    renderCard(
      <DealCard
        deal={{ ...DEAL, deadline: '2026-01-01T00:00:00Z' }}
        onOpen={() => {}}
      />,
    );
    const card = screen.getByRole('article', { name: DEAL.title });
    expect(card).toHaveAttribute('data-expired', 'true');
    expect(within(card).getByText(/Termen expirat/)).toBeVisible();
    expect(within(card).queryByText('Expirat')).toBeNull();
    const stub = stubIn(card);
    expect(stub).toHaveAttribute('data-muted', 'true');
    expect(stub).toHaveClass('bg-muted/70');
    // Muted, still the one keyboard-reachable button that reveals the code.
    const reveal = within(stub).getByRole('button', { name: /Arată codul/ });
    expect(reveal).toBeEnabled();
    await user.click(reveal);
    expect(await within(stub).findByText('CAFE50')).toBeVisible();
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
  });

  it('keeps an active stub on the brand tint', () => {
    renderCard(<DealCard deal={DEAL} onOpen={() => {}} />);
    const stub = stubIn(screen.getByRole('article', { name: DEAL.title }));
    expect(stub).not.toHaveAttribute('data-muted');
    expect(stub).toHaveClass('bg-accent/60');
  });
});
